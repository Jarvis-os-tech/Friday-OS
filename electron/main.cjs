const { app, BrowserWindow, session, shell } = require("electron");
const path = require("path");
const http = require("http");
const { fork } = require("child_process");

let mainWindow = null;
let serverProcess = null;
const DEFAULT_PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== "production" && !app.isPackaged;

function getIconPath() {
  if (process.platform === "win32") {
    return path.join(__dirname, "..", "assets", "icon.ico");
  }
  return path.join(__dirname, "..", "assets", "icon.png");
}

// Rapid health check for local backend server (checks every 60ms)
function checkServerReady(port, retries = 150, delay = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry();
        }
      });

      const retry = () => {
        if (attempts >= retries) {
          // Fallback resolve after threshold so user is not permanently stuck
          resolve(false);
        } else {
          setTimeout(check, delay);
        }
      };

      req.on("error", retry);
      req.setTimeout(250, () => {
        req.destroy();
        retry();
      });
    };
    check();
  });
}

// Start backend server in packaged / production standalone mode
function startBackendServer() {
  if (isDev) {
    return;
  }

  const serverBundlePath = path.join(__dirname, "..", "dist", "server.cjs");
  console.log("Launching embedded Friday backend server from:", serverBundlePath);

  try {
    serverProcess = fork(serverBundlePath, [], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(DEFAULT_PORT),
      },
      stdio: "pipe",
    });

    if (serverProcess.stdout) {
      serverProcess.stdout.on("data", (data) => {
        console.log(`[Server]: ${data.toString().trim()}`);
      });
    }

    if (serverProcess.stderr) {
      serverProcess.stderr.on("data", (data) => {
        console.error(`[Server Error]: ${data.toString().trim()}`);
      });
    }

    serverProcess.on("exit", (code, signal) => {
      console.log(`Embedded server exited with code ${code} / signal ${signal}`);
    });
  } catch (err) {
    console.error("Failed to fork backend server process:", err);
  }
}

function stopBackendServer() {
  if (serverProcess) {
    console.log("Shutting down embedded backend server process...");
    try {
      serverProcess.kill();
    } catch (e) {
      console.error("Error killing server process:", e);
    }
    serverProcess = null;
  }
}

function createWindow() {
  const icon = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 890,
    minWidth: 960,
    minHeight: 640,
    title: "FRIDAY - AI Voice Assistant",
    icon: icon,
    backgroundColor: "#07090e",
    show: true, // Display instantly!
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false, // Keep voice streaming active in background
    },
  });

  // Load the instant animated splash screen immediately
  const splashPath = path.join(__dirname, "splash.html");
  mainWindow.loadFile(splashPath);

  // Handle external links safely in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Auto-grant microphone, camera, and display-capture permissions
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = [
      "media",
      "mediaKeySystem",
      "geolocation",
      "notifications",
      "midi",
      "midiSysex",
      "pointerLock",
      "fullscreen",
      "openExternal",
    ];

    if (allowedPermissions.includes(permission)) {
      return callback(true);
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return true;
  });

  const appUrl = `http://127.0.0.1:${DEFAULT_PORT}`;

  // Check health and smoothly transition from splash to live app
  checkServerReady(DEFAULT_PORT).then(() => {
    console.log(`Server ready! Connecting Friday window to ${appUrl}...`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(appUrl);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  startBackendServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopBackendServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopBackendServer();
});
