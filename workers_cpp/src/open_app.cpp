#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <stdlib.h>

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

void print_error_and_exit(const std::string& msg) {
    std::cout << "{\n  \"error\": \"" << json_escape(msg) << "\",\n  \"code\": 1\n}\n";
    exit(1);
}

bool contains_metacharacters(const std::string& s) {
    const std::string metachars = ";|&`$><";
    for (char c : s) {
        if (metachars.find(c) != std::string::npos) {
            return true;
        }
    }
    return false;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        print_error_and_exit("No arguments provided");
    }

    std::vector<std::string> args;
    for (int i = 1; i < argc; ++i) {
        args.push_back(argv[i]);
    }

    // Check max length and metachars
    size_t total_len = 0;
    for (const auto& arg : args) {
        if (contains_metacharacters(arg)) {
            print_error_and_exit("Command contains shell metacharacters");
        }
        total_len += arg.length();
    }
    
    if (total_len > 4096) {
        print_error_and_exit("Argument length exceeds 4096 characters");
    }

    std::vector<std::string> exec_args;
    
    // Check if it's a URL
    const std::string& first_arg = args[0];
    if (first_arg.find("http://") == 0 || first_arg.find("https://") == 0 || first_arg.find("file://") == 0) {
        exec_args.push_back("xdg-open");
        for (const auto& arg : args) {
            exec_args.push_back(arg);
        }
    } else {
        exec_args = args;
    }

    std::vector<char*> c_args;
    for (auto& arg : exec_args) {
        c_args.push_back(const_cast<char*>(arg.c_str()));
    }
    c_args.push_back(nullptr);

    pid_t pid = fork();
    if (pid < 0) {
        print_error_and_exit("Fork failed");
    } else if (pid == 0) {
        // Child process
        setsid();
        int fd = open("/dev/null", O_RDWR);
        if (fd >= 0) {
            dup2(fd, STDIN_FILENO);
            dup2(fd, STDOUT_FILENO);
            dup2(fd, STDERR_FILENO);
            if (fd > STDERR_FILENO) {
                close(fd);
            }
        }
        execvp(c_args[0], c_args.data());
        // If execvp fails, just exit
        exit(1);
    } else {
        // Parent process
        std::ostringstream json;
        json << "{\n";
        json << "  \"status\": \"launched\",\n";
        json << "  \"command\": \"" << json_escape(exec_args[0]) << "\",\n";
        json << "  \"args\": [";
        for (size_t i = 1; i < exec_args.size(); ++i) {
            json << "\"" << json_escape(exec_args[i]) << "\"";
            if (i < exec_args.size() - 1) json << ", ";
        }
        json << "],\n";
        json << "  \"pid\": " << pid << ",\n";
        json << "  \"detached\": true\n";
        json << "}\n";
        std::cout << json.str();
    }

    return 0;
}
