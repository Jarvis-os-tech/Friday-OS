#include <iostream>
#include <string>
#include <memory>
#include <array>
#include <sstream>
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

std::string exec(const char* cmd) {
    std::array<char, 128> buffer;
    std::string result;
    struct pclose_deleter {
        void operator()(FILE* f) const {
            if (f) pclose(f);
        }
    };
    std::unique_ptr<FILE, pclose_deleter> pipe(popen(cmd, "r"));
    if (!pipe) {
        return "";
    }
    while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe.get()) != nullptr) {
        result += buffer.data();
    }
    if (!result.empty() && result.back() == '\n') {
        result.pop_back();
    }
    return result;
}

void print_no_player() {
    std::cout << "{\n"
              << "  \"status\": \"no_player\",\n"
              << "  \"message\": \"No active media player detected\"\n"
              << "}\n";
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "{\n  \"error\": \"no_action\",\n  \"message\": \"No action provided (status|play|pause|toggle|next|prev|stop)\"\n}\n";
        return 1;
    }

    std::string action = argv[1];

    if (action == "status") {
        std::string status = exec("playerctl status 2>/dev/null");
        if (status.empty()) {
            print_no_player();
            return 0;
        }

        std::transform(status.begin(), status.end(), status.begin(),
                       [](unsigned char c){ return std::tolower(c); });

        std::string player = exec("playerctl -l 2>/dev/null | head -n 1");
        
        std::string metadata = exec("playerctl metadata --format '{{artist}}|||{{title}}|||{{album}}' 2>/dev/null");
        std::string artist = "", title = "", album = "";
        
        if (!metadata.empty()) {
            size_t pos1 = metadata.find("|||");
            if (pos1 != std::string::npos) {
                artist = metadata.substr(0, pos1);
                size_t pos2 = metadata.find("|||", pos1 + 3);
                if (pos2 != std::string::npos) {
                    title = metadata.substr(pos1 + 3, pos2 - pos1 - 3);
                    album = metadata.substr(pos2 + 3);
                }
            }
        }

        std::cout << "{\n"
                  << "  \"status\": \"" << json_escape(status) << "\",\n"
                  << "  \"player\": \"" << json_escape(player) << "\",\n"
                  << "  \"track\": {\n"
                  << "    \"title\": \"" << json_escape(title) << "\",\n"
                  << "    \"artist\": \"" << json_escape(artist) << "\",\n"
                  << "    \"album\": \"" << json_escape(album) << "\"\n"
                  << "  }\n"
                  << "}\n";
        return 0;
    }

    std::string cmd_action;
    if (action == "toggle") cmd_action = "play-pause";
    else if (action == "play") cmd_action = "play";
    else if (action == "pause") cmd_action = "pause";
    else if (action == "next") cmd_action = "next";
    else if (action == "prev") cmd_action = "previous";
    else if (action == "stop") cmd_action = "stop";
    else {
        std::cerr << "{\n  \"error\": \"invalid_action\",\n  \"message\": \"Unknown action\"\n}\n";
        return 1;
    }

    std::string playerctl_check = exec("playerctl -l 2>/dev/null");
    if (playerctl_check.empty()) {
        print_no_player();
        return 0;
    }

    std::string cmd = "playerctl " + cmd_action + " 2>/dev/null";
    exec(cmd.c_str());

    std::string state = exec("playerctl status 2>/dev/null");
    
    std::cout << "{\n"
              << "  \"status\": \"ok\",\n"
              << "  \"action\": \"" << json_escape(action) << "\",\n"
              << "  \"player_state\": \"" << json_escape(state) << "\"\n"
              << "}\n";

    return 0;
}
