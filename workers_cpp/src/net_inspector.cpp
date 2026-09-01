#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <iomanip>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <fcntl.h>
#include <time.h>
#include <cstring>
#include <sys/time.h>

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

double get_time_ms() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1000000.0;
}

int main() {
    double dns_start = get_time_ms();
    
    struct addrinfo hints = {};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    
    struct addrinfo* res = nullptr;
    int status = getaddrinfo("google.com", nullptr, &hints, &res);
    double dns_time = get_time_ms() - dns_start;
    
    std::string resolved_ip = "";
    bool internet_reachable = false;
    
    if (status == 0 && res != nullptr) {
        char ipstr[INET_ADDRSTRLEN];
        struct sockaddr_in* ipv4 = (struct sockaddr_in*)res->ai_addr;
        inet_ntop(res->ai_family, &(ipv4->sin_addr), ipstr, sizeof(ipstr));
        resolved_ip = ipstr;
        internet_reachable = true;
        freeaddrinfo(res);
    }
    
    // Read /proc/net/route
    std::ifstream route_file("/proc/net/route");
    std::string default_gw_ip = "";
    if (route_file.is_open()) {
        std::string line;
        std::getline(route_file, line); // header
        while (std::getline(route_file, line)) {
            std::istringstream iss(line);
            std::string iface, dest, gateway;
            if (iss >> iface >> dest >> gateway) {
                if (dest == "00000000") {
                    unsigned int gw;
                    std::stringstream ss;
                    ss << std::hex << gateway;
                    ss >> gw;
                    
                    struct in_addr gw_addr;
                    gw_addr.s_addr = gw;
                    default_gw_ip = inet_ntoa(gw_addr);
                    break;
                }
            }
        }
    }
    
    double gw_latency = -1.0;
    bool gw_reachable = false;
    
    if (!default_gw_ip.empty()) {
        int sock = socket(AF_INET, SOCK_STREAM, 0);
        if (sock >= 0) {
            struct timeval tv;
            tv.tv_sec = 2;
            tv.tv_usec = 0;
            setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));
            setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, (const char*)&tv, sizeof(tv));
            
            struct sockaddr_in gw_addr;
            memset(&gw_addr, 0, sizeof(gw_addr));
            gw_addr.sin_family = AF_INET;
            gw_addr.sin_port = htons(80);
            inet_pton(AF_INET, default_gw_ip.c_str(), &gw_addr.sin_addr);
            
            double conn_start = get_time_ms();
            if (connect(sock, (struct sockaddr*)&gw_addr, sizeof(gw_addr)) == 0) {
                gw_latency = get_time_ms() - conn_start;
                gw_reachable = true;
            } else {
                gw_latency = -1.0;
                gw_reachable = false;
            }
            close(sock);
        }
    }
    
    // Read /proc/net/dev
    std::ifstream dev_file("/proc/net/dev");
    std::vector<std::string> interfaces_json;
    if (dev_file.is_open()) {
        std::string line;
        std::getline(dev_file, line); // header 1
        std::getline(dev_file, line); // header 2
        while (std::getline(dev_file, line)) {
            size_t colon_pos = line.find(':');
            if (colon_pos == std::string::npos) continue;
            
            std::string iface = line.substr(0, colon_pos);
            // trim whitespace
            size_t first = iface.find_first_not_of(" \t");
            if (first != std::string::npos) iface = iface.substr(first);
            size_t last = iface.find_last_not_of(" \t");
            if (last != std::string::npos) iface = iface.substr(0, last + 1);
            
            if (iface == "lo") continue;
            
            std::istringstream iss(line.substr(colon_pos + 1));
            unsigned long long rx_bytes, rx_packets, rx_errs, rx_drop, rx_fifo, rx_frame, rx_comp, rx_mcast;
            unsigned long long tx_bytes, tx_packets, tx_errs;
            
            if (iss >> rx_bytes >> rx_packets >> rx_errs >> rx_drop >> rx_fifo >> rx_frame >> rx_comp >> rx_mcast 
                    >> tx_bytes >> tx_packets >> tx_errs) {
                std::ostringstream intf_ss;
                intf_ss << "    {\n"
                        << "      \"name\": \"" << json_escape(iface) << "\",\n"
                        << "      \"rx_bytes\": " << rx_bytes << ",\n"
                        << "      \"tx_bytes\": " << tx_bytes << ",\n"
                        << "      \"rx_packets\": " << rx_packets << ",\n"
                        << "      \"tx_packets\": " << tx_packets << ",\n"
                        << "      \"rx_errors\": " << rx_errs << ",\n"
                        << "      \"tx_errors\": " << tx_errs << "\n"
                        << "    }";
                interfaces_json.push_back(intf_ss.str());
            }
        }
    }
    
    std::cout << "{\n"
              << "  \"timestamp\": \"" << iso_timestamp() << "\",\n"
              << "  \"dns_resolution\": {\n"
              << "    \"host\": \"google.com\",\n"
              << "    \"resolved_ip\": \"" << json_escape(resolved_ip) << "\",\n"
              << "    \"time_ms\": " << std::fixed << std::setprecision(2) << dns_time << "\n"
              << "  },\n"
              << "  \"default_gateway\": {\n"
              << "    \"ip\": \"" << json_escape(default_gw_ip) << "\",\n"
              << "    \"latency_ms\": " << gw_latency << ",\n"
              << "    \"reachable\": " << (gw_reachable ? "true" : "false") << "\n"
              << "  },\n"
              << "  \"interfaces\": [\n";
              
    for (size_t i = 0; i < interfaces_json.size(); ++i) {
        std::cout << interfaces_json[i];
        if (i < interfaces_json.size() - 1) std::cout << ",\n";
        else std::cout << "\n";
    }
    
    std::cout << "  ],\n"
              << "  \"internet_reachable\": " << (internet_reachable ? "true" : "false") << "\n"
              << "}\n";
              
    return 0;
}
