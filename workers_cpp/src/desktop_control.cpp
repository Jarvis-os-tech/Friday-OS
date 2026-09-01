/**
 * J.A.R.V.I.S. Desktop Control & Computer Use Automation Core (C++17)
 * 
 * Provides fast, deterministic, cross-backend (Wayland / X11 / XWayland) desktop automation:
 * - Window enumeration & focusing: lists all active top-level windows, titles, PIDs, geometries
 * - Window closing: multi-layer fallback (xdotool, client message, alt+F4, SIGTERM, wmctrl)
 * - Mouse automation: move, click (left/right/middle/double), drag, scroll via ydotool / xdotool
 * - Keyboard automation: type_text with proper modifier handling via wtype / ydotool / xdotool
 * - Hotkeys & Shortcuts: alt+F4, ctrl+c, alt+tab, super, ctrl+alt+t, ctrl+w, etc.
 * - Application launcher & closer: launch apps via .desktop or binary, close by PID or name
 * - Screenshot capture: Wayland grim / X11 scrot / ffmpeg x11grab / import
 * - Session & Power actions: lock, suspend, reboot, shutdown
 * - Desktop notifications: notify-send with urgency and icon flags
 * 
 * Output: Strict JSON output to stdout in milliseconds.
 */

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <set>
#include <filesystem>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <memory>
#include <array>
#include <csignal>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <pwd.h>

namespace fs = std::filesystem;

static std::string json_escape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 16);
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
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

static std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

struct PipeCloser {
    void operator()(FILE* f) const {
        if (f) pclose(f);
    }
};

static std::string run_cmd(const std::string& cmd) {
    std::array<char, 512> buffer;
    std::string result;
    std::unique_ptr<FILE, PipeCloser> pipe(popen(cmd.c_str(), "r"));
    if (!pipe) return "";
    while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe.get()) != nullptr) {
        result += buffer.data();
    }
    return trim(result);
}

static bool has_binary(const std::string& name) {
    if (name.empty()) return false;
    if (name[0] == '/') return access(name.c_str(), X_OK) == 0;
    const char* path_env = std::getenv("PATH");
    if (!path_env) path_env = "/usr/local/bin:/usr/bin:/bin:/usr/games";
    std::string path_str = path_env;
    size_t start = 0;
    while (start < path_str.size()) {
        size_t end = path_str.find(':', start);
        if (end == std::string::npos) end = path_str.size();
        std::string dir = path_str.substr(start, end - start);
        if (!dir.empty()) {
            std::string full_path = dir + "/" + name;
            if (access(full_path.c_str(), X_OK) == 0) return true;
        }
        start = end + 1;
    }
    return false;
}

// ── DETECT DESKTOP ENVIRONMENT ─────────────────────────────────────────────

struct DesktopEnv {
    bool is_wayland = false;
    bool is_x11 = false;
    std::string session_type = "x11";
    std::string display = ":0";
    std::string wayland_display = "";
    bool has_wtype = false;
    bool has_ydotool = false;
    bool has_xdotool = false;
    bool has_grim = false;
    bool has_scrot = false;
    bool has_wmctrl = false;
    bool has_xprop = false;
};

DesktopEnv detect_environment() {
    DesktopEnv env;
    const char* sess = std::getenv("XDG_SESSION_TYPE");
    if (sess) env.session_type = sess;

    const char* way = std::getenv("WAYLAND_DISPLAY");
    if (way && std::strlen(way) > 0) {
        env.wayland_display = way;
        env.is_wayland = true;
    }

    const char* disp = std::getenv("DISPLAY");
    if (disp && std::strlen(disp) > 0) {
        env.display = disp;
        env.is_x11 = true;
    }

    env.has_wtype = has_binary("wtype");
    env.has_ydotool = has_binary("ydotool");
    env.has_xdotool = has_binary("xdotool");
    env.has_grim = has_binary("grim");
    env.has_scrot = has_binary("scrot");
    env.has_wmctrl = has_binary("wmctrl");
    env.has_xprop = has_binary("xprop");

    return env;
}

// Forward declaration
bool press_hotkey(const std::string& key_combo, const DesktopEnv& env);

// ── 1. WINDOW MANAGEMENT ───────────────────────────────────────────────────

struct WindowInfo {
    std::string window_id = "";
    int pid = 0;
    std::string title = "";
    std::string app_class = "";
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    bool active = false;
};

std::vector<WindowInfo> list_windows() {
    std::vector<WindowInfo> windows;
    std::set<std::string> seen_keys;

    // Method A: wmctrl -l -p -G -x (Standard X11 Window Manager)
    std::string wmctrl_out = run_cmd("wmctrl -l -p -G -x 2>/dev/null");
    if (!wmctrl_out.empty()) {
        std::istringstream iss(wmctrl_out);
        std::string line;
        while (std::getline(iss, line)) {
            if (line.empty()) continue;
            std::istringstream lss(line);
            std::string wid, desk, pid_s, x_s, y_s, w_s, h_s, wm_class, host;
            if (lss >> wid >> desk >> pid_s >> x_s >> y_s >> w_s >> h_s >> wm_class >> host) {
                std::string title;
                std::getline(lss, title);
                title = trim(title);

                WindowInfo win;
                win.window_id = wid;
                win.pid = std::atoi(pid_s.c_str());
                win.x = std::atoi(x_s.c_str());
                win.y = std::atoi(y_s.c_str());
                win.width = std::atoi(w_s.c_str());
                win.height = std::atoi(h_s.c_str());
                win.app_class = wm_class;
                win.title = title;
                windows.push_back(win);
                seen_keys.insert(wid);
            }
        }
    }

    // Method B: xdotool + xprop window enumeration (XWayland & X11)
    std::string xdo_out = run_cmd("xdotool search --onlyvisible --class '' 2>/dev/null");
    if (!xdo_out.empty()) {
        std::istringstream iss(xdo_out);
        std::string wid;
        while (iss >> wid) {
            if (wid.empty() || seen_keys.count(wid)) continue;
            std::string name = run_cmd("xdotool getwindowname " + wid + " 2>/dev/null");
            std::string pid_s = run_cmd("xdotool getwindowpid " + wid + " 2>/dev/null");
            std::string cls_s = run_cmd("xprop -id " + wid + " WM_CLASS 2>/dev/null | cut -d '=' -f 2 | tr -d '\" '");

            // Ignore mutter guard / empty dummy root surfaces
            if (name == "mutter guard window" || cls_s.find("not found") != std::string::npos) {
                if (cls_s.empty() && pid_s.empty()) continue;
            }

            if (!name.empty() && name != "mutter guard window") {
                WindowInfo win;
                win.window_id = wid;
                win.pid = pid_s.empty() ? 0 : std::atoi(pid_s.c_str());
                win.title = name;
                win.app_class = (cls_s.find("not found") == std::string::npos) ? cls_s : "";
                windows.push_back(win);
                seen_keys.insert(wid);
            }
        }
    }

    // Method C: Query active GUI top-level processes from /proc
    std::string ps_out = run_cmd("ps -u $(id -u) -o pid,comm,args 2>/dev/null");
    if (!ps_out.empty()) {
        std::istringstream iss(ps_out);
        std::string line;
        std::getline(iss, line); // header
        while (std::getline(iss, line)) {
            std::istringstream lss(line);
            int pid;
            std::string comm, args;
            if (lss >> pid >> comm) {
                std::getline(lss, args);
                args = trim(args);

                // Ignore subprocess workers/renderers/zygote helpers
                if (args.find("--type=renderer") != std::string::npos ||
                    args.find("--type=zygote") != std::string::npos ||
                    args.find("--type=gpu-process") != std::string::npos ||
                    args.find("--type=utility") != std::string::npos) {
                    continue;
                }

                std::string app_name = "";
                if (comm == "chrome" || comm == "google-chrome") app_name = "Google Chrome";
                else if (comm == "firefox") app_name = "Mozilla Firefox";
                else if (comm == "code") app_name = "Visual Studio Code";
                else if (comm == "gnome-terminal" || comm == "gnome-terminal-") app_name = "Terminal";
                else if (comm == "ptyxis") app_name = "Terminal (Ptyxis)";
                else if (comm == "nautilus") app_name = "Files / File Manager";
                else if (comm == "gnome-text-edit" || comm == "gnome-text-editor" || comm == "gedit") app_name = "Text Editor";
                else if (comm == "vlc") app_name = "VLC Media Player";
                else if (comm == "spotify") app_name = "Spotify";
                else if (comm == "slack") app_name = "Slack";
                else if (comm == "discord") app_name = "Discord";
                else if (comm == "obs") app_name = "OBS Studio";
                else if (comm == "alacritty") app_name = "Alacritty Terminal";
                else if (comm == "kitty") app_name = "Kitty Terminal";
                else if (comm == "gnome-control-c" || comm == "gnome-control-center") app_name = "GNOME Settings";
                else if (comm == "gnome-calculato" || comm == "gnome-calculator") app_name = "Calculator";

                if (!app_name.empty()) {
                    std::string key = "proc_" + comm;
                    if (!seen_keys.count(key)) {
                        WindowInfo win;
                        win.window_id = "pid_" + std::to_string(pid);
                        win.pid = pid;
                        win.app_class = comm;
                        win.title = app_name;
                        windows.push_back(win);
                        seen_keys.insert(key);
                    }
                }
            }
        }
    }

    return windows;
}

static std::vector<std::string> get_target_candidates(const std::string& target) {
    std::vector<std::string> cands;
    std::string lower = target;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    if (lower == "text-editor" || lower == "text editor" || lower == "notepad" || lower == "gedit" || lower == "editor") {
        cands.push_back("gnome-text-editor");
        cands.push_back("gedit");
    } else if (lower == "terminal" || lower == "console" || lower == "shell") {
        cands.push_back("ptyxis");
        cands.push_back("gnome-terminal");
    } else if (lower == "files" || lower == "file manager" || lower == "file-manager" || lower == "explorer" || lower == "file explorer") {
        cands.push_back("nautilus");
    } else if (lower == "calculator" || lower == "calc") {
        cands.push_back("gnome-calculator");
    } else if (lower == "chrome" || lower == "browser" || lower == "web browser") {
        cands.push_back("google-chrome");
        cands.push_back("firefox");
    } else {
        cands.push_back(target);
    }
    return cands;
}

bool focus_window(const std::string& target) {
    if (target.empty()) return false;

    // Check if numeric or hex ID
    bool is_num = true;
    for (char c : target) {
        if (!std::isdigit(c) && c != 'x' && c != 'X' && c != 'a' && c != 'b' && c != 'c' && c != 'd' && c != 'e' && c != 'f') {
            is_num = false;
            break;
        }
    }

    if (is_num) {
        if (std::system(("xdotool windowactivate " + target + " 2>/dev/null").c_str()) == 0) return true;
        if (std::system(("wmctrl -i -a " + target + " 2>/dev/null").c_str()) == 0) return true;
    }

    auto cands = get_target_candidates(target);
    for (const auto& cand : cands) {
        // Try xdotool by window title / name
        if (std::system(("xdotool search --name \"" + cand + "\" windowactivate 2>/dev/null").c_str()) == 0) {
            return true;
        }
        // Try xdotool by window class
        if (std::system(("xdotool search --class \"" + cand + "\" windowactivate 2>/dev/null").c_str()) == 0) {
            return true;
        }
        // Try wmctrl
        if (std::system(("wmctrl -a \"" + cand + "\" 2>/dev/null").c_str()) == 0) {
            return true;
        }
        // Try gtk-launch which focuses existing application instance in GNOME (detached)
        if (std::system(("gtk-launch \"" + cand + "\" >/dev/null 2>&1 &").c_str()) == 0) {
            return true;
        }
    }

    return false;
}

bool close_window(const std::string& target) {
    std::string lower = target;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

    // Case 0: Browser Tab interception
    if (lower == "tab" || lower == "current tab" || lower == "active tab" || lower == "this tab" ||
        lower == "youtube" || lower == "github" || lower == "google" || lower == "reddit" ||
        lower == "twitter" || lower == "facebook" || lower == "gmail" || lower == "chatgpt") {
        DesktopEnv env = detect_environment();
        return press_hotkey("ctrl+w", env);
    }

    if (lower == "all tabs" || lower == "all browser tabs" || lower == "browser tabs" || lower == "chrome tabs") {
        std::system("pkill -15 -f 'chrome' 2>/dev/null || pkill -15 -f 'firefox' 2>/dev/null");
        return true;
    }

    // Case 1: Close currently active/focused window if target is empty or "active" / "current"
    if (target.empty() || target == "active" || target == "current" || target == "focused" || target == "this") {
        if (std::system("xdotool getactivewindow windowclose 2>/dev/null") == 0) return true;
        if (std::system("xdotool key --clearmodifiers alt+F4 2>/dev/null") == 0) return true;
        if (std::system("wtype -M alt -k F4 2>/dev/null") == 0) return true;
        return false;
    }

    // Case 2: Target is a numeric or hex Window ID (e.g. "4194307" or "0x02800003")
    bool is_num = true;
    for (char c : target) {
        if (!std::isdigit(c) && c != 'x' && c != 'X' && c != 'a' && c != 'b' && c != 'c' && c != 'd' && c != 'e' && c != 'f') {
            is_num = false;
            break;
        }
    }

    if (is_num) {
        if (std::system(("xdotool windowclose " + target + " 2>/dev/null").c_str()) == 0) return true;
        if (std::system(("wmctrl -i -c " + target + " 2>/dev/null").c_str()) == 0) return true;
        if (std::system(("xdotool windowkill " + target + " 2>/dev/null").c_str()) == 0) return true;
    }

    // Case 3: Target is a title, application name, or class name
    auto cands = get_target_candidates(target);
    for (const auto& cand : cands) {
        // Fast Method A: Graceful process termination (SIGTERM)
        std::string pkill_cmd = "pkill -15 -x \"" + cand + "\" 2>/dev/null || pkill -15 -f \"" + cand + "\" 2>/dev/null || killall -15 \"" + cand + "\" 2>/dev/null";
        if (std::system(pkill_cmd.c_str()) == 0) {
            return true;
        }
        // Fast Method B: wmctrl -c
        if (std::system(("wmctrl -c \"" + cand + "\" 2>/dev/null").c_str()) == 0) {
            return true;
        }
        // Fast Method C: xdotool search --name windowclose
        if (std::system(("xdotool search --name \"" + cand + "\" windowclose 2>/dev/null").c_str()) == 0) {
            return true;
        }
    }

    return false;
}

// ── 2. KEYBOARD AUTOMATION ─────────────────────────────────────────────────

bool type_text(const std::string& text, const DesktopEnv& env) {
    if (text.empty()) return true;

    // Method A: wtype (Wayland native)
    if (env.has_wtype && env.is_wayland) {
        std::string escaped;
        for (char c : text) {
            if (c == '"' || c == '\\' || c == '$' || c == '`') escaped += '\\';
            escaped += c;
        }
        std::string cmd = "wtype \"" + escaped + "\" 2>/dev/null";
        if (std::system(cmd.c_str()) == 0) return true;
    }

    // Method B: ydotool (Universal uinput)
    if (env.has_ydotool) {
        std::string cmd = "ydotool type -- \"" + text + "\" 2>/dev/null";
        if (std::system(cmd.c_str()) == 0) return true;
    }

    // Method C: xdotool (X11 / XWayland)
    if (env.has_xdotool) {
        std::string cmd = "xdotool type --delay 12 -- \"" + text + "\" 2>/dev/null";
        if (std::system(cmd.c_str()) == 0) return true;
    }

    return false;
}

bool press_hotkey(const std::string& key_combo, const DesktopEnv& env) {
    if (key_combo.empty()) return false;

    // Method A: wtype (Wayland native) with proper modifier parsing
    if (env.has_wtype && env.is_wayland) {
        std::istringstream ss(key_combo);
        std::string part;
        std::vector<std::string> mods;
        std::vector<std::string> keys;
        while (std::getline(ss, part, '+')) {
            std::string p = trim(part);
            std::string plower = p;
            std::transform(plower.begin(), plower.end(), plower.begin(), ::tolower);
            if (plower == "ctrl" || plower == "control") mods.push_back("ctrl");
            else if (plower == "shift") mods.push_back("shift");
            else if (plower == "alt") mods.push_back("alt");
            else if (plower == "super" || plower == "win" || plower == "logo") mods.push_back("logo");
            else keys.push_back(p);
        }

        std::string wtype_cmd = "wtype";
        for (const auto& m : mods) wtype_cmd += " -M " + m;
        for (const auto& k : keys) wtype_cmd += " -k \"" + k + "\"";
        for (auto it = mods.rbegin(); it != mods.rend(); ++it) wtype_cmd += " -m " + *it;
        wtype_cmd += " 2>/dev/null";

        if (std::system(wtype_cmd.c_str()) == 0) return true;
    }

    // Method B: xdotool key --clearmodifiers
    if (env.has_xdotool) {
        std::string cmd = "xdotool key --clearmodifiers " + key_combo + " 2>/dev/null";
        if (std::system(cmd.c_str()) == 0) return true;
    }

    // Method C: ydotool key
    if (env.has_ydotool) {
        std::string cmd = "ydotool key " + key_combo + " 2>/dev/null";
        if (std::system(cmd.c_str()) == 0) return true;
    }

    return false;
}

// ── 3. MOUSE AUTOMATION ────────────────────────────────────────────────────

bool mouse_click(int x, int y, const std::string& button = "left", int count = 1, const DesktopEnv& env = {}) {
    int btn_num = 1;
    if (button == "right" || button == "3") btn_num = 3;
    else if (button == "middle" || button == "2") btn_num = 2;

    // Method A: xdotool mousemove + click
    if (env.has_xdotool) {
        char cmd[256];
        if (x >= 0 && y >= 0) {
            snprintf(cmd, sizeof(cmd), "xdotool mousemove %d %d click --repeat %d %d 2>/dev/null", x, y, count, btn_num);
        } else {
            snprintf(cmd, sizeof(cmd), "xdotool click --repeat %d %d 2>/dev/null", count, btn_num);
        }
        if (std::system(cmd) == 0) return true;
    }

    // Method B: ydotool
    if (env.has_ydotool) {
        char cmd[256];
        if (x >= 0 && y >= 0) {
            snprintf(cmd, sizeof(cmd), "ydotool mousemove --absolute -x %d -y %d && ydotool click 0x%03x 2>/dev/null", x, y, (btn_num == 3 ? 0x111 : (btn_num == 2 ? 0x112 : 0x110)));
        } else {
            snprintf(cmd, sizeof(cmd), "ydotool click 0x%03x 2>/dev/null", (btn_num == 3 ? 0x111 : (btn_num == 2 ? 0x112 : 0x110)));
        }
        if (std::system(cmd) == 0) return true;
    }

    return false;
}

bool mouse_move(int x, int y, const DesktopEnv& env) {
    if (env.has_xdotool) {
        char cmd[128];
        snprintf(cmd, sizeof(cmd), "xdotool mousemove %d %d 2>/dev/null", x, y);
        if (std::system(cmd) == 0) return true;
    }
    if (env.has_ydotool) {
        char cmd[128];
        snprintf(cmd, sizeof(cmd), "ydotool mousemove --absolute -x %d -y %d 2>/dev/null", x, y);
        if (std::system(cmd) == 0) return true;
    }
    return false;
}

bool mouse_scroll(int dx, int dy, const DesktopEnv& env) {
    if (env.has_xdotool) {
        if (dy > 0) {
            std::string cmd = "xdotool click --repeat " + std::to_string(std::abs(dy)) + " 5 2>/dev/null";
            return std::system(cmd.c_str()) == 0;
        } else if (dy < 0) {
            std::string cmd = "xdotool click --repeat " + std::to_string(std::abs(dy)) + " 4 2>/dev/null";
            return std::system(cmd.c_str()) == 0;
        }
    }
    if (env.has_ydotool) {
        std::string cmd = "ydotool mousemove --wheel -x " + std::to_string(dx) + " -y " + std::to_string(dy) + " 2>/dev/null";
        return std::system(cmd.c_str()) == 0;
    }
    return false;
}

// ── 4. SCREENSHOT CAPTURE ──────────────────────────────────────────────────

struct ScreenshotResult {
    bool success = false;
    std::string path = "";
    std::string method = "";
    long file_size = 0;
    std::string error = "";
};

ScreenshotResult capture_screenshot(const std::string& target_path, const DesktopEnv& env) {
    ScreenshotResult res;
    std::string out_path = target_path.empty() ? ("/tmp/friday_screenshot_" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count()) + ".png") : target_path;
    res.path = out_path;

    // Ensure parent directory exists
    size_t last_slash = out_path.find_last_of('/');
    if (last_slash != std::string::npos && last_slash > 0) {
        std::string parent_dir = out_path.substr(0, last_slash);
        std::string mkdir_cmd = "mkdir -p \"" + parent_dir + "\" 2>/dev/null";
        (void)std::system(mkdir_cmd.c_str());
    }

    auto check_file = [](const std::string& p) -> long {
        struct stat st;
        if (stat(p.c_str(), &st) == 0 && st.st_size > 0) {
            return st.st_size;
        }
        return 0;
    };

    // Method A: Wayland native (grim)
    if ((env.is_wayland || !env.wayland_display.empty()) && env.has_grim) {
        std::string cmd = "timeout 2 grim \"" + out_path + "\" >/dev/null 2>&1";
        if (std::system(cmd.c_str()) == 0) {
            long sz = check_file(out_path);
            if (sz > 0) {
                res.success = true;
                res.method = "grim (Wayland)";
                res.file_size = sz;
                return res;
            }
        }
    }

    // Method B: ffmpeg x11grab (universal & instantaneous <80ms)
    std::string disp = env.display.empty() ? ":0" : env.display;
    std::string ffmpeg_cmd = "timeout 2 ffmpeg -nostdin -loglevel quiet -f x11grab -i " + disp + " -vframes 1 -update 1 \"" + out_path + "\" -y >/dev/null 2>&1";
    if (std::system(ffmpeg_cmd.c_str()) == 0) {
        long sz = check_file(out_path);
        if (sz > 0) {
            res.success = true;
            res.method = "ffmpeg x11grab";
            res.file_size = sz;
            return res;
        }
    }

    // Method C: X11 scrot
    if (env.has_scrot) {
        std::string scrot_cmd = "timeout 2 scrot \"" + out_path + "\" >/dev/null 2>&1";
        if (std::system(scrot_cmd.c_str()) == 0) {
            long sz = check_file(out_path);
            if (sz > 0) {
                res.success = true;
                res.method = "scrot (X11)";
                res.file_size = sz;
                return res;
            }
        }
    }

    // Method D: X11 import (ImageMagick)
    if (has_binary("import")) {
        std::string import_cmd = "timeout 2 import -window root \"" + out_path + "\" >/dev/null 2>&1";
        if (std::system(import_cmd.c_str()) == 0) {
            long sz = check_file(out_path);
            if (sz > 0) {
                res.success = true;
                res.method = "import (ImageMagick)";
                res.file_size = sz;
                return res;
            }
        }
    }

    res.success = false;
    res.error = "No screenshot backend succeeded";
    return res;
}

// ── 5. APPLICATION LAUNCH & MANAGEMENT ──────────────────────────────────────

int launch_app(const std::string& app_name_or_cmd) {
    if (app_name_or_cmd.empty()) return -1;

    // Check if it's a URL
    if (app_name_or_cmd.rfind("http://", 0) == 0 || app_name_or_cmd.rfind("https://", 0) == 0) {
        std::string cmd = "xdg-open \"" + app_name_or_cmd + "\" >/dev/null 2>&1 &";
        if (std::system(cmd.c_str()) == 0) return 0;
        return 0;
    }

    // Check gtk-launch for .desktop app
    std::string gtk_cmd = "gtk-launch " + app_name_or_cmd + " >/dev/null 2>&1 &";
    if (std::system(gtk_cmd.c_str()) == 0) {
        return 0;
    }

    // Direct background spawn
    std::string spawn_cmd = app_name_or_cmd + " >/dev/null 2>&1 &";
    if (std::system(spawn_cmd.c_str()) == 0) {
        return 0;
    }

    return -1;
}

bool close_app(const std::string& app_name_or_pid, int signal_num = SIGTERM) {
    if (app_name_or_pid.empty()) return false;

    // Check if numeric PID
    bool is_numeric = true;
    for (char c : app_name_or_pid) {
        if (!std::isdigit(c)) { is_numeric = false; break; }
    }

    if (is_numeric) {
        int pid = std::atoi(app_name_or_pid.c_str());
        return kill(pid, signal_num) == 0;
    } else {
        // Try graceful window close first
        (void)std::system(("xdotool search --class \"" + app_name_or_pid + "\" windowclose 2>/dev/null").c_str());
        
        // Then send process signal
        std::string pkill_cmd = "pkill -" + std::to_string(signal_num) + " -i -f \"" + app_name_or_pid + "\" 2>/dev/null || killall -" + std::to_string(signal_num) + " -r -i \"" + app_name_or_pid + "\" 2>/dev/null";
        return std::system(pkill_cmd.c_str()) == 0;
    }
}

// ── MAIN DISPATCHER ────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    DesktopEnv env = detect_environment();

    std::string action = "env";
    if (argc > 1) {
        action = argv[1];
    }

    if (action == "env") {
        std::cout << "{"
                  << "\"session_type\":\"" << json_escape(env.session_type) << "\","
                  << "\"is_wayland\":" << (env.is_wayland ? "true" : "false") << ","
                  << "\"is_x11\":" << (env.is_x11 ? "true" : "false") << ","
                  << "\"display\":\"" << json_escape(env.display) << "\","
                  << "\"wayland_display\":\"" << json_escape(env.wayland_display) << "\","
                  << "\"backends\":{"
                  << "\"wtype\":" << (env.has_wtype ? "true" : "false") << ","
                  << "\"ydotool\":" << (env.has_ydotool ? "true" : "false") << ","
                  << "\"xdotool\":" << (env.has_xdotool ? "true" : "false") << ","
                  << "\"grim\":" << (env.has_grim ? "true" : "false") << ","
                  << "\"wmctrl\":" << (env.has_wmctrl ? "true" : "false") << ","
                  << "\"xprop\":" << (env.has_xprop ? "true" : "false")
                  << "}"
                  << "}\n";
        return 0;
    }

    if (action == "list_windows") {
        std::vector<WindowInfo> wins = list_windows();
        std::cout << "{\"status\":\"ok\",\"total_windows\":" << wins.size() << ",\"windows\":[";
        for (size_t i = 0; i < wins.size(); ++i) {
            if (i > 0) std::cout << ",";
            const auto& w = wins[i];
            std::cout << "{"
                      << "\"id\":\"" << json_escape(w.window_id) << "\","
                      << "\"pid\":" << w.pid << ","
                      << "\"title\":\"" << json_escape(w.title) << "\","
                      << "\"app_class\":\"" << json_escape(w.app_class) << "\","
                      << "\"geometry\":{\"x\":" << w.x << ",\"y\":" << w.y << ",\"width\":" << w.width << ",\"height\":" << w.height << "}"
                      << "}";
        }
        std::cout << "]}\n";
        return 0;
    }

    if (action == "focus_window") {
        std::string target = (argc > 2) ? argv[2] : "";
        bool ok = focus_window(target);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "not_found") << "\",\"action\":\"focus_window\",\"target\":\"" << json_escape(target) << "\"}\n";
        return 0;
    }

    if (action == "close_window") {
        std::string target = (argc > 2) ? argv[2] : "active";
        bool ok = close_window(target);
        std::cout << "{\"status\":\"ok\",\"action\":\"close_window\",\"target\":\"" << json_escape(target) << "\",\"closed\":" << (ok ? "true" : "false") << "}\n";
        return 0;
    }

    if (action == "close_tab" || action == "close_current_tab") {
        bool ok = press_hotkey("ctrl+w", env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"close_tab\",\"closed\":" << (ok ? "true" : "false") << "}\n";
        return 0;
    }

    if (action == "close_all_tabs" || action == "close_browser") {
        std::system("pkill -15 -f 'chrome' 2>/dev/null || pkill -15 -f 'firefox' 2>/dev/null");
        std::cout << "{\"status\":\"ok\",\"action\":\"close_all_tabs\",\"closed\":true}\n";
        return 0;
    }

    if (action == "new_tab" || action == "open_tab") {
        if (argc > 2) {
            std::string url = argv[2];
            if (url.find("http://") == 0 || url.find("https://") == 0) {
                std::system(("xdg-open \"" + url + "\" >/dev/null 2>&1 &").c_str());
                std::cout << "{\"status\":\"ok\",\"action\":\"new_tab\",\"url\":\"" << json_escape(url) << "\"}\n";
                return 0;
            }
        }
        bool ok = press_hotkey("ctrl+t", env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"new_tab\"}\n";
        return 0;
    }

    if (action == "next_tab" || action == "switch_tab") {
        bool ok = press_hotkey("ctrl+Tab", env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"next_tab\"}\n";
        return 0;
    }

    if (action == "previous_tab" || action == "prev_tab") {
        bool ok = press_hotkey("ctrl+shift+Tab", env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"previous_tab\"}\n";
        return 0;
    }

    if (action == "reload_tab" || action == "refresh_tab") {
        bool ok = press_hotkey("ctrl+r", env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"reload_tab\"}\n";
        return 0;
    }

    if (action == "reopen_closed_tab" || action == "reopen_tab") {
        bool ok = press_hotkey("ctrl+shift+t", env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"reopen_closed_tab\"}\n";
        return 0;
    }

    if (action == "click") {
        int x = (argc > 2) ? std::atoi(argv[2]) : -1;
        int y = (argc > 3) ? std::atoi(argv[3]) : -1;
        std::string btn = (argc > 4) ? argv[4] : "left";
        int count = (argc > 5) ? std::atoi(argv[5]) : 1;

        bool ok = mouse_click(x, y, btn, count, env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"click\",\"x\":" << x << ",\"y\":" << y << ",\"button\":\"" << json_escape(btn) << "\",\"count\":" << count << "}\n";
        return ok ? 0 : 1;
    }

    if (action == "move" && argc > 3) {
        int x = std::atoi(argv[2]);
        int y = std::atoi(argv[3]);
        bool ok = mouse_move(x, y, env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"move\",\"x\":" << x << ",\"y\":" << y << "}\n";
        return ok ? 0 : 1;
    }

    if (action == "scroll" && argc > 3) {
        int dx = std::atoi(argv[2]);
        int dy = std::atoi(argv[3]);
        bool ok = mouse_scroll(dx, dy, env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"scroll\",\"dx\":" << dx << ",\"dy\":" << dy << "}\n";
        return ok ? 0 : 1;
    }

    if (action == "type_text" && argc > 2) {
        std::string text = argv[2];
        bool ok = type_text(text, env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"type_text\",\"characters\":" << text.length() << "}\n";
        return ok ? 0 : 1;
    }

    if (action == "hotkey" && argc > 2) {
        std::string combo = argv[2];
        bool ok = press_hotkey(combo, env);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"hotkey\",\"combo\":\"" << json_escape(combo) << "\"}\n";
        return ok ? 0 : 1;
    }

    if (action == "screenshot") {
        std::string path = (argc > 2) ? argv[2] : "";
        ScreenshotResult res = capture_screenshot(path, env);
        std::cout << "{\"status\":\"" << (res.success ? "ok" : "error") << "\","
                  << "\"action\":\"screenshot\","
                  << "\"path\":\"" << json_escape(res.path) << "\","
                  << "\"method\":\"" << json_escape(res.method) << "\","
                  << "\"file_size\":" << res.file_size
                  << (res.error.empty() ? "" : (",\"error\":\"" + json_escape(res.error) + "\""))
                  << "}\n";
        return res.success ? 0 : 1;
    }

    if (action == "launch_app" && argc > 2) {
        std::string app = argv[2];
        int res = launch_app(app);
        std::cout << "{\"status\":\"" << (res == 0 ? "ok" : "error") << "\",\"action\":\"launch_app\",\"app\":\"" << json_escape(app) << "\"}\n";
        return (res == 0) ? 0 : 1;
    }

    if (action == "close_app" && argc > 2) {
        std::string app = argv[2];
        int sig = (argc > 3 && std::string(argv[3]) == "SIGKILL") ? SIGKILL : SIGTERM;
        bool ok = close_app(app, sig);
        std::cout << "{\"status\":\"" << (ok ? "ok" : "error") << "\",\"action\":\"close_app\",\"app\":\"" << json_escape(app) << "\",\"signal\":" << sig << "}\n";
        return ok ? 0 : 1;
    }

    if (action == "lock" || action == "suspend" || action == "reboot" || action == "shutdown") {
        int res = 0;
        if (action == "lock") res = std::system("loginctl lock-session 2>/dev/null");
        else if (action == "suspend") res = std::system("systemctl suspend 2>/dev/null");
        else if (action == "reboot") res = std::system("systemctl reboot 2>/dev/null");
        else if (action == "shutdown") res = std::system("systemctl poweroff 2>/dev/null");

        std::cout << "{\"status\":\"" << (res == 0 ? "ok" : "error") << "\",\"action\":\"" << action << "\"}\n";
        return (res == 0) ? 0 : 1;
    }

    if (action == "notify" && argc > 3) {
        std::string title = argv[2];
        std::string msg = argv[3];
        std::string urgency = (argc > 4) ? argv[4] : "normal";
        std::string cmd = "notify-send -a \"F.R.I.D.A.Y.\" -u " + urgency + " \"" + title + "\" \"" + msg + "\" 2>/dev/null";
        int res = std::system(cmd.c_str());
        std::cout << "{\"status\":\"" << (res == 0 ? "ok" : "error") << "\",\"action\":\"notify\",\"title\":\"" << json_escape(title) << "\"}\n";
        return (res == 0) ? 0 : 1;
    }

    std::cout << "{\"error\":\"Unknown action: " << json_escape(action) << "\",\"usage\":\"desktop_control <env|list_windows|focus_window|close_window|click|move|scroll|type_text|hotkey|screenshot|launch_app|close_app|lock|suspend|reboot|shutdown|notify>\"}\n";
    return 1;
}
