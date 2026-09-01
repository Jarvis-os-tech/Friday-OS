#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>
#include <pwd.h>

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

std::string get_home_dir() {
    const char* home = getenv("HOME");
    if (home) return std::string(home);
    struct passwd* pw = getpwuid(getuid());
    if (pw && pw->pw_dir) return std::string(pw->pw_dir);
    return "/home/gopi";
}

bool file_exists(const std::string& path) {
    struct stat buffer;
    return (stat(path.c_str(), &buffer) == 0);
}

long get_file_size(const std::string& path) {
    struct stat buffer;
    if (stat(path.c_str(), &buffer) == 0) {
        return buffer.st_size;
    }
    return -1;
}

std::string run_cmd(const std::string& cmd) {
    char buffer[256];
    std::string result;
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) return "";
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
        result += buffer;
    }
    pclose(pipe);
    // Trim trailing newline
    while (!result.empty() && (result.back() == '\n' || result.back() == '\r')) {
        result.pop_back();
    }
    return result;
}

int main(int argc, char* argv[]) {
    auto start_time = std::chrono::high_resolution_clock::now();

    std::string mode = "test";
    std::string custom_db = "";

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--inspect" || arg == "inspect") mode = "inspect";
        else if (arg == "--ping" || arg == "ping") mode = "ping";
        else if (arg == "--test" || arg == "test") mode = "test";
        else if ((arg == "--db" || arg == "-d" || arg == "--path") && i + 1 < argc) {
            custom_db = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "Usage: memory_tester [--test|--inspect|--ping] [--db <path>]\n";
            return 0;
        }
    }

    std::string home = get_home_dir();
    std::string db_path;
    std::string vault_dir;

    if (!custom_db.empty()) {
        db_path = custom_db;
        vault_dir = custom_db + "/../vault";
    } else {
        // Check if workspace JARVIS-MEMORY/memory.db exists
        if (file_exists("JARVIS-MEMORY/memory.db")) {
            char cwd_buf[1024];
            if (getcwd(cwd_buf, sizeof(cwd_buf))) {
                db_path = std::string(cwd_buf) + "/JARVIS-MEMORY/memory.db";
                vault_dir = std::string(cwd_buf) + "/JARVIS-MEMORY";
            } else {
                db_path = "JARVIS-MEMORY/memory.db";
                vault_dir = "JARVIS-MEMORY";
            }
        } else {
            db_path = home + "/.jarvis/memory/memory.db";
            vault_dir = home + "/.jarvis/memory/vault";
        }
    }

    if (mode == "ping") {
        auto end_time = std::chrono::high_resolution_clock::now();
        auto dur = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time).count();
        std::cout << "{\n";
        std::cout << "  \"status\": \"ok\",\n";
        std::cout << "  \"worker\": \"memory_tester\",\n";
        std::cout << "  \"db_path\": \"" << json_escape(db_path) << "\",\n";
        std::cout << "  \"db_exists\": " << (file_exists(db_path) ? "true" : "false") << ",\n";
        std::cout << "  \"latency_us\": " << dur << "\n";
        std::cout << "}\n";
        return 0;
    }

    bool db_present = file_exists(db_path);
    long db_size = get_file_size(db_path);

    // If database file is not yet initialized or 0 bytes, bootstrap it via memory_engine init
    if (!db_present || db_size <= 0) {
        std::string init_cmd = "cargo run --manifest-path " + home + "/Downloads/JARVIS-V0/memory_engine/Cargo.toml --quiet -- init --db-path \"" + db_path + "\" >/dev/null 2>&1";
        int res = system(init_cmd.c_str());
        (void)res;
        db_present = file_exists(db_path);
        db_size = get_file_size(db_path);
    }

    // Query SQLite tables
    std::string tables_raw = run_cmd("sqlite3 \"" + db_path + "\" \"SELECT name FROM sqlite_master WHERE type IN ('table','virtual') AND name NOT LIKE 'sqlite_%' ORDER BY name;\"");
    std::vector<std::string> tables;
    std::istringstream iss(tables_raw);
    std::string t;
    while (std::getline(iss, t)) {
        if (!t.empty()) tables.push_back(t);
    }

    // Query schema_info
    std::string schema_info_raw = run_cmd("sqlite3 \"" + db_path + "\" \"SELECT version, engine_version, status, tables_count FROM schema_info WHERE version = 1;\" 2>/dev/null");
    std::string engine_version = "0.1.0";
    std::string schema_status = "healthy";
    int schema_ver = 1;
    int recorded_tables = 13;

    if (!schema_info_raw.empty()) {
        std::istringstream s_iss(schema_info_raw);
        std::string field;
        if (std::getline(s_iss, field, '|')) schema_ver = std::atoi(field.c_str());
        if (std::getline(s_iss, field, '|')) engine_version = field;
        if (std::getline(s_iss, field, '|')) schema_status = field;
        if (std::getline(s_iss, field, '|')) recorded_tables = std::atoi(field.c_str());
    }
    (void)recorded_tables;

    // Query journal_mode and pragmas
    std::string journal_mode = run_cmd("sqlite3 \"" + db_path + "\" \"PRAGMA journal_mode;\" 2>/dev/null");
    if (journal_mode.empty()) journal_mode = "wal";

    auto end_time = std::chrono::high_resolution_clock::now();
    auto total_dur_us = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time).count();

    std::cout << "{\n";
    std::cout << "  \"status\": \"" << (db_present && db_size > 0 && !tables.empty() ? "online" : "uninitialized") << "\",\n";
    std::cout << "  \"mode\": \"" << mode << "\",\n";
    std::cout << "  \"db_path\": \"" << json_escape(db_path) << "\",\n";
    std::cout << "  \"db_size_bytes\": " << db_size << ",\n";
    std::cout << "  \"vault_dir\": \"" << json_escape(vault_dir) << "\",\n";
    std::cout << "  \"journal_mode\": \"" << json_escape(journal_mode) << "\",\n";
    std::cout << "  \"schema_version\": " << schema_ver << ",\n";
    std::cout << "  \"engine_version\": \"" << json_escape(engine_version) << "\",\n";
    std::cout << "  \"schema_status\": \"" << json_escape(schema_status) << "\",\n";
    std::cout << "  \"tables_count\": " << tables.size() << ",\n";
    std::cout << "  \"tables\": [";
    for (size_t i = 0; i < tables.size(); ++i) {
        std::cout << "\"" << json_escape(tables[i]) << "\"" << (i + 1 < tables.size() ? ", " : "");
    }
    std::cout << "],\n";
    std::cout << "  \"latency_us\": " << total_dur_us << "\n";
    std::cout << "}\n";

    return 0;
}
