#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <iomanip>
#include <sys/sysinfo.h>
#include <sys/statvfs.h>
#include <ctime>
#include <cmath>

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
            default:   out += c;
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

void print_error(const std::string& msg) {
    std::cout << "{\n  \"error\": \"" << json_escape(msg) << "\"\n}\n";
}

int main() {
    try {
        // 1. sysinfo
        struct sysinfo info;
        if (sysinfo(&info) != 0) {
            print_error("Failed to get sysinfo");
            return 1;
        }

        // 1. Memory Ground Truth from /proc/meminfo
        double ram_total_mb = 0.0;
        double ram_free_mb = 0.0;
        double ram_used_mb = 0.0;
        double ram_usage_percent = 0.0;

        std::ifstream meminfo_file("/proc/meminfo");
        if (meminfo_file.is_open()) {
            std::string line;
            unsigned long long mem_total_kb = 0;
            unsigned long long mem_free_kb = 0;
            unsigned long long mem_available_kb = 0;
            unsigned long long buffers_kb = 0;
            unsigned long long cached_kb = 0;

            while (std::getline(meminfo_file, line)) {
                std::istringstream iss(line);
                std::string key;
                unsigned long long val = 0;
                iss >> key >> val;
                if (key == "MemTotal:") mem_total_kb = val;
                else if (key == "MemFree:") mem_free_kb = val;
                else if (key == "MemAvailable:") mem_available_kb = val;
                else if (key == "Buffers:") buffers_kb = val;
                else if (key == "Cached:") cached_kb = val;
            }

            unsigned long long effective_avail_kb = mem_available_kb > 0 ? mem_available_kb : (mem_free_kb + buffers_kb + cached_kb);
            unsigned long long used_kb = mem_total_kb > effective_avail_kb ? (mem_total_kb - effective_avail_kb) : 0;

            ram_total_mb = mem_total_kb / 1024.0;
            ram_free_mb = effective_avail_kb / 1024.0;
            ram_used_mb = used_kb / 1024.0;
            if (ram_total_mb > 0) {
                ram_usage_percent = (ram_used_mb / ram_total_mb) * 100.0;
            }
        } else {
            // Fallback to sysinfo
            ram_total_mb = (static_cast<double>(info.totalram) * info.mem_unit) / (1024.0 * 1024.0);
            ram_free_mb = (static_cast<double>(info.freeram) * info.mem_unit) / (1024.0 * 1024.0);
            ram_used_mb = ram_total_mb - ram_free_mb;
            if (ram_total_mb > 0) {
                ram_usage_percent = (ram_used_mb / ram_total_mb) * 100.0;
            }
        }

        long uptime = info.uptime;
        long days = uptime / 86400;
        long hours = (uptime % 86400) / 3600;
        long mins = (uptime % 3600) / 60;
        std::ostringstream uptime_ss;
        uptime_ss << days << "d " << hours << "h " << mins << "m";

        double load_1 = info.loads[0] / 65536.0;
        double load_5 = info.loads[1] / 65536.0;
        double load_15 = info.loads[2] / 65536.0;

        // 2. /proc/stat instantaneous CPU delta sampling (40ms delta)
        auto read_stat = []() -> std::pair<unsigned long long, unsigned long long> {
            std::ifstream stat_f("/proc/stat");
            if (stat_f.is_open()) {
                std::string line;
                if (std::getline(stat_f, line)) {
                    std::istringstream iss(line);
                    std::string cpu_label;
                    iss >> cpu_label;
                    if (cpu_label == "cpu") {
                        unsigned long long u = 0, n = 0, s = 0, idl = 0, iow = 0, irq = 0, soft = 0, stl = 0;
                        iss >> u >> n >> s >> idl >> iow >> irq >> soft >> stl;
                        unsigned long long tot = u + n + s + idl + iow + irq + soft + stl;
                        unsigned long long idl_tot = idl + iow;
                        return {idl_tot, tot};
                    }
                }
            }
            return {0, 0};
        };

        double cpu_usage_percent = 0.0;
        auto [idle1, total1] = read_stat();
        timespec req = {0, 40000000}; // 40ms
        nanosleep(&req, nullptr);
        auto [idle2, total2] = read_stat();

        if (total2 > total1) {
            unsigned long long d_tot = total2 - total1;
            unsigned long long d_idle = idle2 - idle1;
            unsigned long long d_active = d_tot > d_idle ? (d_tot - d_idle) : 0;
            cpu_usage_percent = (static_cast<double>(d_active) / d_tot) * 100.0;
        }

        // 3. statvfs
        struct statvfs stat_vfs;
        if (statvfs("/", &stat_vfs) != 0) {
            print_error("Failed to get statvfs");
            return 1;
        }

        double disk_total_gb = (static_cast<double>(stat_vfs.f_blocks) * stat_vfs.f_frsize) / (1024.0 * 1024.0 * 1024.0);
        double disk_free_gb = (static_cast<double>(stat_vfs.f_bfree) * stat_vfs.f_frsize) / (1024.0 * 1024.0 * 1024.0);
        double disk_used_gb = disk_total_gb - disk_free_gb;
        double disk_usage_percent = 0.0;
        if (disk_total_gb > 0) {
            disk_usage_percent = (disk_used_gb / disk_total_gb) * 100.0;
        }

        // 4. Output JSON
        std::cout << std::fixed << std::setprecision(1);
        std::cout << "{\n";
        std::cout << "  \"timestamp\": \"" << iso_timestamp() << "\",\n";
        std::cout << "  \"cpu_usage_percent\": " << cpu_usage_percent << ",\n";
        std::cout << "  \"load_avg\": [" << load_1 << ", " << load_5 << ", " << load_15 << "],\n";
        std::cout << "  \"ram_total_mb\": " << static_cast<long long>(std::round(ram_total_mb)) << ",\n";
        std::cout << "  \"ram_used_mb\": " << static_cast<long long>(std::round(ram_used_mb)) << ",\n";
        std::cout << "  \"ram_free_mb\": " << static_cast<long long>(std::round(ram_free_mb)) << ",\n";
        std::cout << "  \"ram_usage_percent\": " << ram_usage_percent << ",\n";
        std::cout << "  \"disk_total_gb\": " << disk_total_gb << ",\n";
        std::cout << "  \"disk_used_gb\": " << disk_used_gb << ",\n";
        std::cout << "  \"disk_free_gb\": " << disk_free_gb << ",\n";
        std::cout << "  \"disk_usage_percent\": " << disk_usage_percent << ",\n";
        std::cout << "  \"uptime\": \"" << json_escape(uptime_ss.str()) << "\"\n";
        std::cout << "}\n";

    } catch (const std::exception& e) {
        print_error(e.what());
        return 1;
    }
    return 0;
}
