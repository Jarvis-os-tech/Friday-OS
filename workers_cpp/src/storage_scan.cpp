#include <iostream>
#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <unordered_set>
#include <sys/statvfs.h>
#include <ctime>
#include <iomanip>

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

struct MountInfo {
    std::string fs_spec;
    std::string fs_file;
    std::string fs_vfstype;
};

int main() {
    std::ifstream mounts_file("/proc/mounts");
    if (!mounts_file.is_open()) {
        std::cerr << "{\"error\": \"Could not open /proc/mounts\"}\n";
        return 1;
    }

    std::unordered_set<std::string> ignored_fs_types = {
        "tmpfs", "devtmpfs", "sysfs", "proc", "cgroup", "cgroup2", "securityfs", "debugfs",
        "hugetlbfs", "mqueue", "configfs", "pstore", "fusectl", "squashfs",
        "overlay", "tracefs", "binfmt_misc", "bpf", "autofs", "efivarfs",
        "rpc_pipefs", "devpts"
    };

    std::vector<MountInfo> valid_mounts;
    std::string line;
    while (std::getline(mounts_file, line)) {
        std::istringstream iss(line);
        MountInfo info;
        std::string dummy1, dummy2, dummy3;
        if (iss >> info.fs_spec >> info.fs_file >> info.fs_vfstype >> dummy1 >> dummy2 >> dummy3) {
            if (ignored_fs_types.count(info.fs_vfstype) > 0) {
                // Ensure overlay mounts on /snap/* are skipped, but others might be kept?
                // Wait, requirements say: skip ... `overlay` (on /snap/*)
                // If the vfstype is overlay and it's NOT on /snap/, do we keep it? 
                // The requirements say: filter out ... "overlay (on /snap/*)".
                // I will skip all overlays that are on /snap/ and allow others. Wait, it also says filter out squashfs.
                if (info.fs_vfstype == "overlay" && info.fs_file.find("/snap/") != 0) {
                    // Keep this one if it's an overlay not on /snap/*
                } else {
                    continue;
                }
            }
            if (info.fs_file.find("/snap/") == 0) {
                continue;
            }
            valid_mounts.push_back(info);
        }
    }

    std::ostringstream json;
    json << std::fixed << std::setprecision(1);
    json << "{\n";
    json << "  \"timestamp\": \"" << iso_timestamp() << "\",\n";
    json << "  \"mounts\": [\n";

    int mount_count = 0;
    bool first = true;
    for (const auto& mount : valid_mounts) {
        struct statvfs stat;
        if (statvfs(mount.fs_file.c_str(), &stat) == 0) {
            if (stat.f_blocks == 0) {
                continue; // Skip zero-sized filesystems
            }
            
            double total_gb = static_cast<double>(stat.f_blocks) * stat.f_frsize / (1024.0 * 1024.0 * 1024.0);
            double free_gb = static_cast<double>(stat.f_bfree) * stat.f_frsize / (1024.0 * 1024.0 * 1024.0);
            double used_gb = total_gb - free_gb;
            double usage_percent = total_gb > 0 ? (used_gb / total_gb) * 100.0 : 0.0;

            if (!first) {
                json << ",\n";
            }
            first = false;

            json << "    {\n"
                 << "      \"filesystem\": \"" << json_escape(mount.fs_spec) << "\",\n"
                 << "      \"mounted_on\": \"" << json_escape(mount.fs_file) << "\",\n"
                 << "      \"fs_type\": \"" << json_escape(mount.fs_vfstype) << "\",\n"
                 << "      \"total_gb\": " << total_gb << ",\n"
                 << "      \"used_gb\": " << used_gb << ",\n"
                 << "      \"free_gb\": " << free_gb << ",\n"
                 << "      \"usage_percent\": " << usage_percent << "\n"
                 << "    }";
            mount_count++;
        }
    }

    json << "\n  ],\n";
    json << "  \"mount_count\": " << mount_count << "\n";
    json << "}\n";

    std::cout << json.str();

    return 0;
}
