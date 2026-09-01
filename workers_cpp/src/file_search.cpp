#include <iostream>
#include <string>
#include <filesystem>
#include <chrono>
#include <vector>
#include <sstream>
#include <time.h>
#include <string.h>
#include <cstdlib>

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

std::string iso_timestamp(fs::file_time_type ftime) {
    auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
        ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
    time_t time = std::chrono::system_clock::to_time_t(sctp);
    struct tm t;
    gmtime_r(&time, &t);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
    return buf;
}

bool glob_match(const char* pattern, const char* str) {
    while (*pattern) {
        if (*pattern == '*') {
            while (*pattern == '*') ++pattern;
            if (!*pattern) return true;
            while (*str) {
                if (glob_match(pattern, str)) return true;
                ++str;
            }
            return false;
        } else if (*pattern == '?' || *pattern == *str) {
            if (!*str) return false;
            ++pattern;
            ++str;
        } else {
            return false;
        }
    }
    return !*str;
}

struct MatchResult {
    std::string path;
    uintmax_t size_bytes;
    bool is_directory;
    std::string last_modified;
};

void print_error_and_exit(const std::string& msg) {
    std::cout << "{\n  \"error\": \"" << json_escape(msg) << "\"\n}\n";
    exit(1);
}

int main(int argc, char* argv[]) {
    struct timespec start_time, end_time;
    clock_gettime(CLOCK_MONOTONIC, &start_time);

    if (argc < 3) {
        print_error_and_exit("Usage: " + std::string(argv[0]) + " <root_directory> <pattern> [--max <N>]");
    }

    std::string root_dir = argv[1];
    std::string pattern = argv[2];
    int max_results = 50;

    for (int i = 3; i < argc; ++i) {
        if (std::string(argv[i]) == "--max" && i + 1 < argc) {
            max_results = std::atoi(argv[++i]);
        }
    }

    std::error_code root_ec;
    if (!fs::exists(root_dir, root_ec) || !fs::is_directory(root_dir, root_ec)) {
        print_error_and_exit("Invalid root directory");
    }

    std::vector<MatchResult> matches;
    int total_matches = 0;
    bool truncated = false;

    auto options = fs::directory_options::skip_permission_denied;
    std::error_code ec;

    auto it = fs::recursive_directory_iterator(root_dir, options, ec);
    auto end = fs::recursive_directory_iterator();

    while (it != end) {
        if (ec) {
            it.increment(ec);
            continue;
        }

        const auto& entry = *it;
        std::string filename = entry.path().filename().string();
        if (glob_match(pattern.c_str(), filename.c_str())) {
            total_matches++;
            if ((int)matches.size() < max_results) {
                MatchResult r;
                r.path = entry.path().string();
                
                std::error_code inner_ec;
                r.is_directory = entry.is_directory(inner_ec);
                
                if (r.is_directory) {
                    r.size_bytes = 0;
                } else {
                    r.size_bytes = entry.file_size(inner_ec);
                    if (inner_ec) r.size_bytes = 0;
                }
                
                auto ftime = entry.last_write_time(inner_ec);
                if (!inner_ec) {
                    r.last_modified = iso_timestamp(ftime);
                } else {
                    r.last_modified = "";
                }
                
                matches.push_back(r);
            } else {
                truncated = true;
            }
        }

        it.increment(ec);
    }

    clock_gettime(CLOCK_MONOTONIC, &end_time);
    double scan_time_ms = (end_time.tv_sec - start_time.tv_sec) * 1000.0 + 
                          (end_time.tv_nsec - start_time.tv_nsec) / 1000000.0;

    std::cout << "{\n";
    std::cout << "  \"root\": \"" << json_escape(root_dir) << "\",\n";
    std::cout << "  \"pattern\": \"" << json_escape(pattern) << "\",\n";
    std::cout << "  \"matches\": [\n";
    for (size_t i = 0; i < matches.size(); ++i) {
        const auto& m = matches[i];
        std::cout << "    {\n";
        std::cout << "      \"path\": \"" << json_escape(m.path) << "\",\n";
        std::cout << "      \"size_bytes\": " << m.size_bytes << ",\n";
        std::cout << "      \"is_directory\": " << (m.is_directory ? "true" : "false") << ",\n";
        std::cout << "      \"last_modified\": \"" << json_escape(m.last_modified) << "\"\n";
        std::cout << "    }" << (i + 1 < matches.size() ? "," : "") << "\n";
    }
    std::cout << "  ],\n";
    std::cout << "  \"total_matches\": " << total_matches << ",\n";
    std::cout << "  \"truncated\": " << (truncated ? "true" : "false") << ",\n";
    std::cout << "  \"scan_time_ms\": " << scan_time_ms << "\n";
    std::cout << "}\n";

    return 0;
}
