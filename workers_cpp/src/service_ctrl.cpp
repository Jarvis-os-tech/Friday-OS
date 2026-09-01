#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <array>
#include <algorithm>

std::string json_escape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 10);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

void error_exit(const std::string& msg) {
    std::cerr << "{\"error\": \"" << json_escape(msg) << "\"}\n";
    std::exit(1);
}

bool is_valid_unit_name(const std::string& unit) {
    if (unit.empty() || unit.size() > 255) return false;
    for (char c : unit) {
        if (!isalnum(c) && c != '.' && c != '-' && c != '_' && c != '@' && c != '\\') {
            return false;
        }
    }
    return true;
}

struct PipeCloser {
    void operator()(FILE* f) const {
        if (f) pclose(f);
    }
};

std::string exec_cmd(const std::string& cmd) {
    std::array<char, 256> buffer;
    std::string result;
    std::unique_ptr<FILE, PipeCloser> pipe(popen(cmd.c_str(), "r"));
    if (!pipe) return "";
    while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe.get()) != nullptr) {
        result += buffer.data();
    }
    return result;
}

void cmd_list() {
    std::string out;
    try {
        out = exec_cmd("systemctl list-units --type=service --no-pager --plain --no-legend 2>/dev/null");
    } catch (const std::exception& e) {
        error_exit(e.what());
    }

    std::stringstream ss(out);
    std::string line;
    std::vector<std::string> services;
    int total = 0;
    while (std::getline(ss, line)) {
        if (line.empty()) continue;
        std::stringstream ls(line);
        std::string unit, load, active, sub;
        ls >> unit >> load >> active >> sub;
        std::string desc;
        std::string word;
        while (ls >> word) {
            if (!desc.empty()) desc += " ";
            desc += word;
        }
        
        std::stringstream json_obj;
        json_obj << "{"
                 << "\"unit\": \"" << json_escape(unit) << "\", "
                 << "\"load\": \"" << json_escape(load) << "\", "
                 << "\"active\": \"" << json_escape(active) << "\", "
                 << "\"sub\": \"" << json_escape(sub) << "\", "
                 << "\"description\": \"" << json_escape(desc) << "\""
                 << "}";
        services.push_back(json_obj.str());
        total++;
    }

    std::cout << "{\n  \"services\": [\n";
    for (size_t i = 0; i < std::min(services.size(), size_t(50)); ++i) {
        std::cout << "    " << services[i] << (i < std::min(services.size(), size_t(50)) - 1 ? ",\n" : "\n");
    }
    std::cout << "  ],\n  \"total\": " << total << "\n}\n";
}

void cmd_status(const std::string& unit) {
    std::string out;
    try {
        out = exec_cmd("systemctl show " + unit + " --no-pager 2>/dev/null");
    } catch (const std::exception& e) {
        error_exit(e.what());
    }

    std::stringstream ss(out);
    std::string line;
    std::string active_state, sub_state, load_state, description, main_pid;

    while (std::getline(ss, line)) {
        size_t pos = line.find('=');
        if (pos == std::string::npos) continue;
        std::string key = line.substr(0, pos);
        std::string val = line.substr(pos + 1);
        if (key == "ActiveState") active_state = val;
        else if (key == "SubState") sub_state = val;
        else if (key == "LoadState") load_state = val;
        else if (key == "Description") description = val;
        else if (key == "MainPID") main_pid = val;
    }
    
    if (main_pid.empty()) main_pid = "0";

    std::cout << "{\n"
              << "  \"unit\": \"" << json_escape(unit) << "\",\n"
              << "  \"active_state\": \"" << json_escape(active_state) << "\",\n"
              << "  \"sub_state\": \"" << json_escape(sub_state) << "\",\n"
              << "  \"main_pid\": " << main_pid << ",\n"
              << "  \"load_state\": \"" << json_escape(load_state) << "\",\n"
              << "  \"description\": \"" << json_escape(description) << "\"\n"
              << "}\n";
}

void cmd_action(const std::string& action, const std::string& unit) {
    std::string cmd = "systemctl " + action + " " + unit + " >/dev/null 2>&1";
    int ret = std::system(cmd.c_str());
    if (ret != 0) {
        error_exit("Command failed: systemctl " + action + " " + unit);
    }
    
    std::string out;
    try {
        out = exec_cmd("systemctl show " + unit + " --property=ActiveState --value 2>/dev/null");
    } catch (const std::exception& e) {
        error_exit(e.what());
    }
    
    std::string new_state;
    if (!out.empty() && out.back() == '\n') out.pop_back();
    new_state = out;
    
    std::cout << "{\n"
              << "  \"status\": \"ok\",\n"
              << "  \"action\": \"" << json_escape(action) << "\",\n"
              << "  \"unit\": \"" << json_escape(unit) << "\",\n"
              << "  \"new_state\": \"" << json_escape(new_state) << "\"\n"
              << "}\n";
}

int main(int argc, char** argv) {
    if (argc < 2) {
        error_exit("Usage: service_ctrl <list|status|start|stop|restart|enable|disable> [unit]");
    }
    
    std::string cmd = argv[1];
    if (cmd == "list") {
        cmd_list();
    } else {
        if (argc < 3) {
            error_exit("Missing unit name");
        }
        std::string unit = argv[2];
        if (!is_valid_unit_name(unit)) {
            error_exit("Invalid unit name");
        }
        
        if (cmd == "status") {
            cmd_status(unit);
        } else if (cmd == "start" || cmd == "stop" || cmd == "restart" || cmd == "enable" || cmd == "disable") {
            cmd_action(cmd, unit);
        } else {
            error_exit("Unknown command: " + cmd);
        }
    }
    
    return 0;
}
