#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <cstdio>
#include <memory>
#include <array>
#include <stdexcept>
#include <ctime>
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

std::string iso_timestamp() {
    time_t now = time(nullptr);
    struct tm t;
    gmtime_r(&now, &t);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
    return buf;
}

std::string exec(const char* cmd) {
    std::array<char, 128> buffer;
    std::string result;
    std::unique_ptr<FILE, void(*)(FILE*)> pipe(popen(cmd, "r"), [](FILE* f) { pclose(f); });
    if (!pipe) {
        return "";
    }
    while (fgets(buffer.data(), buffer.size(), pipe.get()) != nullptr) {
        result += buffer.data();
    }
    return result;
}

void trim(std::string &s) {
    if (s.empty()) return;
    s.erase(0, s.find_first_not_of(" \t\r\n"));
    s.erase(s.find_last_not_of(" \t\r\n") + 1);
}

struct InterfaceStats {
    std::string name;
    unsigned long long rx_bytes;
    unsigned long long tx_bytes;
};

int main() {
    try {
        std::string timestamp = iso_timestamp();

        // 1. Get interfaces
        std::vector<InterfaceStats> interfaces;
        std::ifstream proc_dev("/proc/net/dev");
        std::string line;
        
        // Skip first two lines
        if (std::getline(proc_dev, line)) {}
        if (std::getline(proc_dev, line)) {}

        std::string wifi_iface = "";
        
        while (std::getline(proc_dev, line)) {
            std::istringstream iss(line);
            std::string name;
            iss >> name;
            if (name.empty()) continue;
            
            if (name.back() == ':') {
                name.pop_back();
            }
            
            if (name == "lo") continue;

            unsigned long long rx_bytes = 0, rx_packets = 0, rx_errs = 0, rx_drop = 0, rx_fifo = 0, rx_frame = 0, rx_compressed = 0, rx_multicast = 0;
            unsigned long long tx_bytes = 0;

            iss >> rx_bytes >> rx_packets >> rx_errs >> rx_drop >> rx_fifo >> rx_frame >> rx_compressed >> rx_multicast >> tx_bytes;

            interfaces.push_back({name, rx_bytes, tx_bytes});
        }
        
        // Check for wifi interface in /proc/net/wireless
        std::ifstream proc_wireless("/proc/net/wireless");
        if (std::getline(proc_wireless, line) && std::getline(proc_wireless, line)) {
            while (std::getline(proc_wireless, line)) {
                std::istringstream iss(line);
                std::string name;
                iss >> name;
                if (!name.empty() && name.back() == ':') {
                    name.pop_back();
                    wifi_iface = name;
                    break;
                }
            }
        }

        bool wifi_connected = false;
        std::string ssid = "";
        int signal_dbm = 0;
        int signal_percent = 0;

        if (!wifi_iface.empty()) {
            std::string iw_link_cmd = "iw dev " + wifi_iface + " link 2>/dev/null";
            std::string iw_link_out = exec(iw_link_cmd.c_str());
            
            if (iw_link_out.find("Not connected") == std::string::npos && iw_link_out.length() > 10) {
                wifi_connected = true;
                
                size_t ssid_pos = iw_link_out.find("SSID: ");
                if (ssid_pos != std::string::npos) {
                    size_t ssid_end = iw_link_out.find('\n', ssid_pos);
                    if (ssid_end != std::string::npos) {
                        ssid = iw_link_out.substr(ssid_pos + 6, ssid_end - (ssid_pos + 6));
                        trim(ssid);
                    }
                } else {
                    std::string iwgetid_cmd = "iwgetid -r " + wifi_iface + " 2>/dev/null";
                    ssid = exec(iwgetid_cmd.c_str());
                    trim(ssid);
                }

                size_t sig_pos = iw_link_out.find("signal: ");
                if (sig_pos != std::string::npos) {
                    size_t sig_end = iw_link_out.find(" dBm", sig_pos);
                    if (sig_end != std::string::npos) {
                        std::string sig_str = iw_link_out.substr(sig_pos + 8, sig_end - (sig_pos + 8));
                        trim(sig_str);
                        try {
                            signal_dbm = std::stoi(sig_str);
                            signal_percent = std::max(0, std::min(100, 2 * (signal_dbm + 100)));
                        } catch (...) {}
                    }
                }
            }
        }

        std::string ip_address = exec("hostname -I 2>/dev/null");
        if (!ip_address.empty()) {
            size_t space_pos = ip_address.find(' ');
            if (space_pos != std::string::npos) {
                ip_address = ip_address.substr(0, space_pos);
            }
            trim(ip_address);
        }

        std::ostringstream json;
        json << "{\n";
        json << "  \"timestamp\": \"" << json_escape(timestamp) << "\",\n";
        json << "  \"wifi\": {\n";
        json << "    \"connected\": " << (wifi_connected ? "true" : "false") << ",\n";
        if (wifi_connected) {
            json << "    \"ssid\": \"" << json_escape(ssid) << "\",\n";
            json << "    \"signal_dbm\": " << signal_dbm << ",\n";
            json << "    \"signal_percent\": " << signal_percent << ",\n";
            json << "    \"interface\": \"" << json_escape(wifi_iface) << "\"\n";
        } else {
            json << "    \"ssid\": \"\",\n";
            json << "    \"signal_dbm\": 0,\n";
            json << "    \"signal_percent\": 0,\n";
            json << "    \"interface\": \"\"\n";
        }
        json << "  },\n";
        json << "  \"ip_address\": \"" << json_escape(ip_address) << "\",\n";
        json << "  \"interfaces\": [\n";
        for (size_t i = 0; i < interfaces.size(); ++i) {
            json << "    {\n";
            json << "      \"name\": \"" << json_escape(interfaces[i].name) << "\",\n";
            json << "      \"rx_bytes\": " << interfaces[i].rx_bytes << ",\n";
            json << "      \"tx_bytes\": " << interfaces[i].tx_bytes << "\n";
            json << "    }";
            if (i < interfaces.size() - 1) {
                json << ",";
            }
            json << "\n";
        }
        json << "  ]\n";
        json << "}\n";

        std::cout << json.str();
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "{\"error\": \"" << json_escape(e.what()) << "\"}\n";
        return 1;
    }
}
