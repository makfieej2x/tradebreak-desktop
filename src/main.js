"use strict";

// TradeBreak desktop shell.
// A locked-down window around https://web.tradebreak.com. No trading logic,
// no secrets and no market data live here: the web terminal and its
// protected session cookie stay the single source of truth.

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, session, shell, ipcMain } = require("electron");

const START_URL = "https://web.tradebreak.com/";
const ALLOWED_ORIGINS = new Set(["https://web.tradebreak.com", "https://dash.tradebreak.com"]);
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "notifications", "fullscreen"]);
const PARTITION = "persist:tradebreak";
const PROTOCOL = "tradebreak";

let mainWindow = null;
let pendingDeepLink = null;

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isAllowed(url) {
  return ALLOWED_ORIGINS.has(originOf(url));
}

function openOutside(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      shell.openExternal(parsed.toString());
    }
  } catch {
    // Ignore malformed links.
  }
}

// tradebreak://open/<path>?<query>  ->  https://web.tradebreak.com/<path>?<query>
function deepLinkTarget(link) {
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== `${PROTOCOL}:`) return null;
    const target = new URL(START_URL);
    const rest = `${parsed.host === "open" ? "" : parsed.host}${parsed.pathname}`;
    target.pathname = `/${rest.replace(/^\/+/, "")}`;
    target.search = parsed.search;
    return isAllowed(target.toString()) ? target.toString() : null;
  } catch {
    return null;
  }
}

function handleDeepLink(link) {
  const target = deepLinkTarget(link);
  if (!target) return;
  if (!mainWindow) {
    pendingDeepLink = target;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.loadURL(target);
}

// ---- Window size and position ----------------------------------------------

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch {
    // First launch or unreadable file: use defaults.
  }
  return { width: 1440, height: 900 };
}

function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    // Non-fatal.
  }
}

// ---- Security --------------------------------------------------------------

const webPreferences = {
  preload: path.join(__dirname, "preload.js"),
  partition: PARTITION,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
};

function hardenSession(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAllowed(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && ALLOWED_ORIGINS.has(requestingOrigin),
  );
  // Look like the same Chrome the web terminal is tested on, plus a clear desktop marker.
  const ua = ses
    .getUserAgent()
    .replace(/\s?Electron\/\S+/, "")
    .replace(/\s?tradebreak-desktop\/\S+/i, "")
    .replace(/\s?TradeBreak\/\S+/, "");
  ses.setUserAgent(`${ua} TradeBreakDesktop/${app.getVersion()}`);
}

function hardenContents(contents) {
  contents.on("will-attach-webview", (event) => event.preventDefault());

  const guard = (event, url) => {
    if (url.startsWith("file:") && contents.getURL().startsWith("file:")) return;
    if (!isAllowed(url)) {
      event.preventDefault();
      openOutside(url);
    }
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { width: 1200, height: 800, webPreferences },
      };
    }
    openOutside(url);
    return { action: "deny" };
  });
}

app.on("web-contents-created", (_event, contents) => hardenContents(contents));

// ---- Window ----------------------------------------------------------------

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 600,
    title: "TradeBreak",
    backgroundColor: "#0b0e14",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences,
  });
  if (state.maximized) win.maximize();

  win.once("ready-to-show", () => win.show());
  win.on("close", () => saveWindowState(win));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Never show stale or fake data when the terminal can't be reached.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isAllowed(url)) return; // -3 = navigation aborted
    win.loadFile(path.join(__dirname, "offline.html"), { query: { retry: url } });
  });

  win.loadURL(pendingDeepLink || START_URL);
  pendingDeepLink = null;
  if (process.env.TRADEBREAK_SMOKE_OUT) runSmokeTest(win, process.env.TRADEBREAK_SMOKE_OUT);
  return win;
}

// ---- CI launch test --------------------------------------------------------
// Used only by the build workflow: launches the packaged app, checks the
// terminal loaded inside the locked-down window, writes a JSON report, quits.

function runSmokeTest(win, outFile) {
  const finish = (report) => {
    try {
      fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    } finally {
      app.exit(report.ok ? 0 : 1);
    }
  };
  const timer = setTimeout(() => finish({ ok: false, error: "timed out after 90 s", url: win.webContents.getURL() }), 90_000);
  win.webContents.once("did-finish-load", async () => {
    clearTimeout(timer);
    try {
      const page = await win.webContents.executeJavaScript(
        `({ title: document.title, desktop: window.tradebreakDesktop?.isDesktop === true,
            nodeHidden: typeof require === "undefined" && typeof process === "undefined",
            userAgent: navigator.userAgent })`,
      );
      const url = win.webContents.getURL();
      const prefs = win.webContents.getLastWebPreferences();
      const report = {
        url,
        ...page,
        sandbox: prefs.sandbox === true,
        contextIsolation: prefs.contextIsolation === true,
        nodeIntegration: prefs.nodeIntegration === true,
        blocksOtherSites: !isAllowed("https://example.com/") && isAllowed(START_URL),
        electron: process.versions.electron,
        platform: `${process.platform}-${process.arch}`,
      };
      report.ok =
        isAllowed(url) && report.desktop && report.nodeHidden && report.sandbox &&
        report.contextIsolation && !report.nodeIntegration && report.blocksOtherSites;
      finish(report);
    } catch (error) {
      finish({ ok: false, error: String(error) });
    }
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Terminal", accelerator: "CmdOrCtrl+1", click: () => mainWindow?.loadURL(START_URL) },
        { label: "Dashboard", click: () => openOutside("https://dash.tradebreak.com/") },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "TradeBreak website", click: () => openOutside("https://tradebreak.com/") },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Updates ---------------------------------------------------------------

function startUpdater() {
  // macOS auto-update needs a signed app; until signing is added, Mac users
  // download new versions manually. Windows updates from GitHub Releases.
  if (!app.isPackaged || process.platform !== "win32") return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch {
    // Updater unavailable: the app still works.
  }
}

// ---- App lifecycle ---------------------------------------------------------

app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  app.on("second-instance", (_event, argv) => {
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  const firstLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (firstLink) pendingDeepLink = deepLinkTarget(firstLink);

  ipcMain.handle("desktop:version", () => app.getVersion());
  ipcMain.handle("desktop:open-external", (event, url) => {
    if (!isAllowed(event.senderFrame?.url || "")) return false;
    openOutside(String(url));
    return true;
  });

  app.whenReady().then(() => {
    hardenSession(session.fromPartition(PARTITION));
    buildMenu();
    mainWindow = createWindow();
    startUpdater();

    app.on("activate", () => {
      if (!mainWindow) mainWindow = createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
