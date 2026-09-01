#include <iostream>
#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <iomanip>
#include <ctime>
#include <chrono>
#include <cstdio>
#include <memory>
#include <array>
#include <arpa/inet.h>

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

std::string iso_timestamp() {
    time_t now = time(nullptr);
    struct tm t;
    gmtime_r(&now, &t);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
    return buf;
}

struct PortInfo {
    int port;
    std::string address;
    std::string protocol;
};

void parse_proc_net(const std::string& filename, std::vector<PortInfo>& listening, int& established, bool is_ipv6) {
    std::ifstream file(filename);
    if (!file) return;

    std::string line;
    std::getline(file, line); // Skip header

    while (std::getline(file, line)) {
        std::istringstream iss(line);
        std::string sl, local_addr, rem_addr, st;
        if (!(iss >> sl >> local_addr >> rem_addr >> st)) continue;

        auto colon_pos = local_addr.find(':');
        if (colon_pos == std::string::npos) continue;

        std::string hex_ip = local_addr.substr(0, colon_pos);
        std::string hex_port = local_addr.substr(colon_pos + 1);

        int port = 0;
        try {
            port = std::stoi(hex_port, nullptr, 16);
        } catch (...) {
            continue;
        }

        std::string ip_str = "";
        if (!is_ipv6) {
            uint32_t ip;
            try {
                ip = std::stoul(hex_ip, nullptr, 16);
            } catch (...) {
                continue;
            }
            struct in_addr addr;
            addr.s_addr = ip;
            ip_str = inet_ntoa(addr);
        } else {
            if (hex_ip.length() == 32) {
                struct in6_addr addr6;
                uint32_t parts[4];
                if (sscanf(hex_ip.c_str(), "%08x%08x%08x%08x", &parts[0], &parts[1], &parts[2], &parts[3]) == 4) {
                    for (int i = 0; i < 4; ++i) {
                        addr6.s6_addr[i*4] = parts[i] & 0xFF;
                        addr6.s6_addr[i*4+1] = (parts[i] >> 8) & 0xFF;
                        addr6.s6_addr[i*4+2] = (parts[i] >> 16) & 0xFF;
                        addr6.s6_addr[i*4+3] = (parts[i] >> 24) & 0xFF;
                    }
                    char buf[INET6_ADDRSTRLEN];
                    if (inet_ntop(AF_INET6, &addr6, buf, sizeof(buf))) {
                        ip_str = buf;
                    }
                }
            }
            if (ip_str.empty()) ip_str = "::";
        }

        if (st == "0A") {
            listening.push_back({port, ip_str, is_ipv6 ? "tcp6" : "tcp"});
        } else if (st == "01") {
            established++;
        }
    }
}

std::string run_command(const char* cmd) {
    std::array<char, 128> buffer;
    std::string result;
    auto pclose_wrapper = [](FILE* f) { return pclose(f); };
    std::unique_ptr<FILE, decltype(pclose_wrapper)> pipe(popen(cmd, "r"), pclose_wrapper);
    if (!pipe) {
        return "";
    }
    while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe.get()) != nullptr) {
        result += buffer.data();
    }
    return result;
}

void output_error(const std::string& msg) {
    std::cout << "{\n"
              << "  \"error\": \"" << json_escape(msg) << "\"\n"
              << "}\n";
    exit(1);
}

int main() {
    try {
        std::vector<PortInfo> listening_ports;
        int established = 0;

        parse_proc_net("/proc/net/tcp", listening_ports, established, false);
        parse_proc_net("/proc/net/tcp6", listening_ports, established, true);

        std::string firewall_summary = run_command("iptables -L -n 2>/dev/null");
        if (firewall_summary.empty()) {
            firewall_summary = run_command("nft list ruleset 2>/dev/null");
        }

        bool firewall_active = !firewall_summary.empty();
        std::string risk_level = "low";

        if (!firewall_active) {
            risk_level = "medium";
            for (const auto& port : listening_ports) {
                if (port.port == 22 || port.port == 3306 || port.port == 8080 || port.port == 21 || port.port == 23) {
                    risk_level = "high";
                    break;
                }
            }
        }

        std::ostringstream json;
        json << "{\n"
             << "  \"timestamp\": \"" << iso_timestamp() << "\",\n"
             << "  \"listening_ports\": [\n";
        
        for (size_t i = 0; i < listening_ports.size(); ++i) {
            json << "    { \"port\": " << listening_ports[i].port
                 << ", \"address\": \"" << json_escape(listening_ports[i].address)
                 << "\", \"protocol\": \"" << json_escape(listening_ports[i].protocol) << "\" }";
            if (i < listening_ports.size() - 1) json << ",";
            json << "\n";
        }

        json << "  ],\n"
             << "  \"listening_count\": " << listening_ports.size() << ",\n"
             << "  \"established_connections\": " << established << ",\n"
             << "  \"firewall_active\": " << (firewall_active ? "true" : "false") << ",\n"
             << "  \"firewall_rules_summary\": \"" << json_escape(firewall_summary.substr(0, 1000)) << "\",\n"
             << "  \"risk_level\": \"" << risk_level << "\"\n"
             << "}\n";

        std::cout << json.str();
        return 0;
    } catch (const std::exception& e) {
        output_error(e.what());
    }
}
