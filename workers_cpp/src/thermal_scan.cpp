#include <iostream>
#include <string>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <vector>
#include <algorithm>
#include <ctime>
#include <iomanip>

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

std::string iso_timestamp() {
    time_t now = time(nullptr);
    struct tm t;
    gmtime_r(&now, &t);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
    return buf;
}

std::string get_status(double temp) {
    if (temp < 60.0) return "normal";
    if (temp <= 80.0) return "warm";
    if (temp <= 95.0) return "hot";
    return "critical";
}

struct SensorData {
    std::string zone;
    std::string type;
    double temp_celsius;
    std::string status;
};

int main() {
    std::vector<SensorData> sensors;
    double max_temp = -999.0;
    std::string overall_status = "normal";

    try {
        const std::string base_path = "/sys/class/thermal";
        if (fs::exists(base_path) && fs::is_directory(base_path)) {
            for (const auto& entry : fs::directory_iterator(base_path)) {
                std::string filename = entry.path().filename().string();
                if (filename.find("thermal_zone") == 0) {
                    std::string type_file = entry.path().string() + "/type";
                    std::string temp_file = entry.path().string() + "/temp";
                    
                    std::string type_name = "unknown";
                    if (fs::exists(type_file)) {
                        std::ifstream t_fs(type_file);
                        if (t_fs.is_open()) {
                            std::getline(t_fs, type_name);
                        }
                    }

                    double temp_celsius = 0.0;
                    if (fs::exists(temp_file)) {
                        std::ifstream t_fs(temp_file);
                        if (t_fs.is_open()) {
                            std::string temp_str;
                            std::getline(t_fs, temp_str);
                            if (!temp_str.empty()) {
                                try {
                                    long temp_milli = std::stol(temp_str);
                                    temp_celsius = temp_milli / 1000.0;
                                } catch (...) {
                                    // ignore parsing errors
                                }
                            }
                        }
                    }

                    SensorData sd;
                    sd.zone = filename;
                    sd.type = type_name;
                    sd.temp_celsius = temp_celsius;
                    sd.status = get_status(temp_celsius);
                    sensors.push_back(sd);

                    if (temp_celsius > max_temp) {
                        max_temp = temp_celsius;
                    }
                }
            }
        }

        if (!sensors.empty()) {
            overall_status = get_status(max_temp);
        } else {
            max_temp = 0.0;
        }

        std::ostringstream json;
        json << "{\n";
        json << "  \"timestamp\": \"" << iso_timestamp() << "\",\n";
        json << "  \"sensors\": [\n";
        
        for (size_t i = 0; i < sensors.size(); ++i) {
            json << "    { ";
            json << "\"zone\": \"" << json_escape(sensors[i].zone) << "\", ";
            json << "\"type\": \"" << json_escape(sensors[i].type) << "\", ";
            json << "\"temp_celsius\": " << std::fixed << std::setprecision(1) << sensors[i].temp_celsius << ", ";
            json << "\"status\": \"" << sensors[i].status << "\" }";
            if (i < sensors.size() - 1) json << ",";
            json << "\n";
        }
        
        json << "  ],\n";
        json << "  \"sensor_count\": " << sensors.size() << ",\n";
        json << "  \"max_temp_celsius\": " << std::fixed << std::setprecision(1) << max_temp << ",\n";
        json << "  \"overall_status\": \"" << overall_status << "\"\n";
        json << "}\n";

        std::cout << json.str();
        return 0;

    } catch (const std::exception& e) {
        std::cerr << "{\n  \"error\": \"" << json_escape(e.what()) << "\"\n}\n";
        return 1;
    } catch (...) {
        std::cerr << "{\n  \"error\": \"Unknown error occurred.\"\n}\n";
        return 1;
    }
}
