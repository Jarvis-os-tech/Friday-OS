/**
 * J.A.R.V.I.S. Master Unified Native System Controller & Introspection Engine (C++17)
 * 
 * Routes and coordinates all native system tasks in sub-milliseconds:
 * - spec: Complete Ground-Truth PC hardware, CPU, RAM, GPU, Motherboard/DMI, Storage, OS spec
 * - telemetry: Live CPU, memory, uptime, and disk telemetry snapshot
 * - hardware: Live audio volume, screen brightness, battery, power profile
 * - processes: Sub-millisecond /proc process scanner and signal dispatcher
 * - storage: Detailed mounted filesystems and statvfs metrics
 * - thermals: Real-time thermal sensor temperatures and throttling state
 * - wifi: Wireless link status, SSID, signal strength (dBm/%), IP address
 * - desktop: Computer use automation (mouse, keyboard, windows, screenshot, power)
 * - services: Systemd service manager (list, status, start, stop, restart, enable, disable)
 * - media: MPRIS / playerctl media playback controller
 * - network: DNS resolution latency, default gateway reachability, network interfaces
 * - firewall: Port audit, iptables/ufw inspection
 * - search: High-speed multithreaded directory and file search
 */

#include <iostream>
#include <string>
#include <vector>
#include <filesystem>
#include <cstdlib>
#include <unistd.h>

namespace fs = std::filesystem;

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cout << "{\"error\":\"Missing command\","
                  << "\"available_commands\":["
                  << "\"spec\","
                  << "\"telemetry\","
                  << "\"hardware\","
                  << "\"processes\","
                  << "\"storage\","
                  << "\"thermals\","
                  << "\"wifi\","
                  << "\"desktop\","
                  << "\"services\","
                  << "\"media\","
                  << "\"network\","
                  << "\"firewall\","
                  << "\"search\""
                  << "]}\n";
        return 1;
    }

    std::string cmd = argv[1];
    std::string bin_dir = "./bin";

    // Try finding binary relative to executable
    char exe_path[1024];
    ssize_t len = readlink("/proc/self/exe", exe_path, sizeof(exe_path) - 1);
    if (len > 0) {
        exe_path[len] = '\0';
        fs::path p(exe_path);
        bin_dir = p.parent_path().string();
    }

    std::string target_bin;
    std::string forwarded_args;

    if (cmd == "spec" || cmd == "pc_spec" || cmd == "info") {
        target_bin = bin_dir + "/pc_spec";
    } else if (cmd == "telemetry" || cmd == "sys_telemetry") {
        target_bin = bin_dir + "/sys_telemetry";
    } else if (cmd == "hardware" || cmd == "hardware_ctrl") {
        target_bin = bin_dir + "/hardware_ctrl";
    } else if (cmd == "processes" || cmd == "process_ctrl" || cmd == "ps" || cmd == "kill") {
        target_bin = bin_dir + "/process_ctrl";
    } else if (cmd == "storage" || cmd == "storage_scan" || cmd == "df") {
        target_bin = bin_dir + "/storage_scan";
    } else if (cmd == "thermals" || cmd == "thermal_scan" || cmd == "temperature") {
        target_bin = bin_dir + "/thermal_scan";
    } else if (cmd == "wifi" || cmd == "wifi_scan") {
        target_bin = bin_dir + "/wifi_scan";
    } else if (cmd == "desktop" || cmd == "desktop_control" || cmd == "computer_use") {
        target_bin = bin_dir + "/desktop_control";
    } else if (cmd == "services" || cmd == "service_ctrl" || cmd == "systemd") {
        target_bin = bin_dir + "/service_ctrl";
    } else if (cmd == "media" || cmd == "media_ctrl" || cmd == "player") {
        target_bin = bin_dir + "/media_ctrl";
    } else if (cmd == "network" || cmd == "net_inspector" || cmd == "ping") {
        target_bin = bin_dir + "/net_inspector";
    } else if (cmd == "firewall" || cmd == "firewall_audit") {
        target_bin = bin_dir + "/firewall_audit";
    } else if (cmd == "search" || cmd == "file_search" || cmd == "find") {
        target_bin = bin_dir + "/file_search";
    } else if (cmd == "open" || cmd == "open_app" || cmd == "launch") {
        target_bin = bin_dir + "/open_app";
    } else {
        std::cout << "{\"error\":\"Unknown command: " << cmd << "\"}\n";
        return 1;
    }

    for (int i = 2; i < argc; ++i) {
        if (!forwarded_args.empty()) forwarded_args += " ";
        forwarded_args += "\"" + std::string(argv[i]) + "\"";
    }

    std::string full_cmd = "\"" + target_bin + "\" " + forwarded_args;
    return std::system(full_cmd.c_str());
}
