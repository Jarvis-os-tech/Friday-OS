#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <cstdlib>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <filesystem>

namespace fs = std::filesystem;

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

std::string shell_escape(const std::string& s) {
    std::string out = "'";
    for (char c : s) {
        if (c == '\'') {
            out += "'\"'\"'";
        } else {
            out += c;
        }
    }
    out += "'";
    return out;
}

void print_error(const std::string& message) {
    std::cout << "{\n"
              << "  \"error\": \"" << json_escape(message) << "\",\n"
              << "  \"code\": 1\n"
              << "}\n";
    std::exit(1);
}

int main(int argc, char** argv) {
    if (argc < 2) {
        print_error("No action specified");
    }

    std::string action = argv[1];

    if (action == "lock") {
        int res = std::system("loginctl lock-session");
        if (res != 0) print_error("Failed to lock screen");
        std::cout << "{\n  \"status\": \"ok\",\n  \"action\": \"lock\",\n  \"message\": \"Screen locked successfully\"\n}\n";
    } else if (action == "suspend") {
        int res = std::system("systemctl suspend");
        if (res != 0) print_error("Failed to suspend system");
        std::cout << "{\n  \"status\": \"ok\",\n  \"action\": \"suspend\",\n  \"message\": \"System suspended successfully\"\n}\n";
    } else if (action == "reboot") {
        int res = std::system("systemctl reboot");
        if (res != 0) print_error("Failed to reboot system");
        std::cout << "{\n  \"status\": \"ok\",\n  \"action\": \"reboot\",\n  \"message\": \"System rebooting\"\n}\n";
    } else if (action == "shutdown") {
        int res = std::system("systemctl poweroff");
        if (res != 0) print_error("Failed to power off system");
        std::cout << "{\n  \"status\": \"ok\",\n  \"action\": \"shutdown\",\n  \"message\": \"System powering off\"\n}\n";
    } else if (action == "notify") {
        if (argc < 4) print_error("Notify requires title and message");
        std::string title = argv[2];
        std::string message = argv[3];
        std::string urgency = "normal";
        if (argc >= 5) urgency = argv[4];

        std::string cmd = "notify-send -a \"J.A.R.V.I.S.\" -u " + shell_escape(urgency) + " " + shell_escape(title) + " " + shell_escape(message);
        int res = std::system(cmd.c_str());
        if (res != 0) print_error("Failed to send notification");
        std::cout << "{\n  \"status\": \"ok\",\n  \"action\": \"notify\",\n  \"message\": \"Notification sent successfully\"\n}\n";
    } else if (action == "screenshot") {
        std::string output_path = "/tmp/jarvis_screenshot.png";
        if (argc >= 3) output_path = argv[2];

        // Ensure parent directory exists
        size_t last_slash = output_path.find_last_of('/');
        if (last_slash != std::string::npos && last_slash > 0) {
            std::string parent_dir = output_path.substr(0, last_slash);
            std::string mkdir_cmd = "mkdir -p " + shell_escape(parent_dir);
            std::system(mkdir_cmd.c_str());
        }

        std::string method = "unknown";
        std::string cmd = "";
        const char* disp = std::getenv("DISPLAY");
        std::string display_str = (disp && std::string(disp) != "") ? std::string(disp) : ":0";

        // Try Method 1: ffmpeg x11grab (universal & instant)
        method = "ffmpeg";
        cmd = "ffmpeg -f x11grab -i " + display_str + " -vframes 1 -update 1 " + shell_escape(output_path) + " -y >/dev/null 2>&1";
        int res = std::system(cmd.c_str());

        // Try Method 2: grim (if on Wayland with grim installed)
        if (res != 0) {
            if (std::system("which grim >/dev/null 2>&1") == 0) {
                method = "grim";
                cmd = "grim " + shell_escape(output_path) + " 2>/dev/null";
                res = std::system(cmd.c_str());
            }
        }

        // Try Method 3: gnome-screenshot
        if (res != 0) {
            if (std::system("which gnome-screenshot >/dev/null 2>&1") == 0) {
                method = "gnome-screenshot";
                cmd = "gnome-screenshot -f " + shell_escape(output_path) + " 2>/dev/null";
                res = std::system(cmd.c_str());
            }
        }

        // Try Method 4: scrot / import
        if (res != 0) {
            if (std::system("which scrot >/dev/null 2>&1") == 0) {
                method = "scrot";
                cmd = "scrot " + shell_escape(output_path) + " 2>/dev/null";
                res = std::system(cmd.c_str());
            } else if (std::system("which import >/dev/null 2>&1") == 0) {
                method = "import";
                cmd = "import -window root " + shell_escape(output_path) + " 2>/dev/null";
                res = std::system(cmd.c_str());
            }
        }

        if (res != 0 || !fs::exists(output_path) || fs::file_size(output_path) == 0) {
            print_error("Failed to take screenshot with available tools (ffmpeg, grim, gnome-screenshot, scrot, import)");
        }

        std::cout << "{\n"
                  << "  \"status\": \"ok\",\n"
                  << "  \"action\": \"screenshot\",\n"
                  << "  \"path\": \"" << json_escape(output_path) << "\",\n"
                  << "  \"method\": \"" << json_escape(method) << "\"\n"
                  << "}\n";
    } else {
        print_error("Unknown action: " + action);
    }

    return 0;
}
