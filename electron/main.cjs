const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
} = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createNotificationService } = require('./notifications.cjs');
const { openDatabase } = require('./database.cjs');
const { createAccountStore } = require('./accounts.cjs');
const {
  copyMaterialFiles,
  deleteCourseMaterials,
  deleteMaterialFile,
  isMaterialExtension,
  readImageDataUrl,
  resolveStoredMaterial,
} = require('./materials.cjs');

// A separate loopback port allows isolated tests without stopping a running copy.
const configuredPort = Number(process.env.CPX_PORT || 17890);
const APP_PORT = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535
  ? configuredPort : 17890;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const DEV_SERVER_URL = process.env.CPX_DEV_URL || '';
const WINDOW_URL = DEV_SERVER_URL || APP_ORIGIN;
const SCHOOL_URL =
  'http://jwxt.neu.edu.cn/jwapp/sys/homeapp/home/index.html?av=&contextPath=/jwapp#/';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

let mainWindow = null;
let server = null;
let tray = null;
let appIcon = null;
let isQuitting = false;
let closeAction = null;
let trayBalloonShown = false;
let desktopSettings = {};
const APP_ID = 'com.coursepilot.desktop';
let notificationService = null;
let database = null;
let databaseUserId = null;
let accountStore = null;
let miniWindow = null;
let miniVisible = false;
let miniMoveTimer = null;

const startHidden = process.argv.includes('--hidden');
const isDevelopmentApp = () => Boolean(process.defaultApp) || Boolean(DEV_SERVER_URL);

// Isolated test/profile directory, useful for running alongside an installed copy.
if (process.env.CPX_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.CPX_USER_DATA_DIR));
}

function getDataDir() {
  if (process.env.CPX_DATA_DIR) return path.resolve(process.env.CPX_DATA_DIR);
  const userData = app.getPath('userData');
  return DEV_SERVER_URL ? path.join(userData, 'development') : userData;
}

function getLegacyDatabasePath() {
  return path.join(getDataDir(), 'coursepilot.db');
}

function closeDatabase() {
  if (database) {
    try {
      database.close();
    } catch (error) {
      console.warn('[CoursePilot] 关闭数据库失败', error);
    }
  }
  database = null;
  databaseUserId = null;
}

function prepareFirstUserData({ userDir, isFirstUser }) {
  if (!isFirstUser) return;
  const sourceDir = getDataDir();
  const source = getLegacyDatabasePath();
  if (!fs.existsSync(source)) return;
  const files = ['coursepilot.db', 'coursepilot.db-wal', 'coursepilot.db-shm'];
  for (const name of files) {
    const from = path.join(sourceDir, name);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(userDir, name));
  }
  const copy = openDatabase(userDir);
  try {
    copy.read();
  } finally {
    copy.close();
  }
  // Keep the original database in place as a one-time backup; accounts use the copied file.
  console.log('[CoursePilot] 已有数据库已归入第一个账号', userDir);
}

function currentMaterialsUserDir() {
  const user = accountStore?.currentUser();
  if (!user) throw new Error('请先登录');
  const userDir = accountStore.userDirFor(user.id);
  fs.mkdirSync(path.join(userDir, 'materials'), { recursive: true });
  return userDir;
}

function authStatusPayload() {
  if (!accountStore) return { ok: false, error: '账号系统尚未初始化' };
  const status = accountStore.status();
  return {
    ok: true,
    ...status,
    legacyDatabaseExists: !status.hasUsers && fs.existsSync(getLegacyDatabasePath()),
    dataDir: getDataDir(),
  };
}

if (process.platform === 'win32') {
  app.setAppUserModelId(isDevelopmentApp() ? process.execPath : APP_ID);
}

function registerWindowsNotifications() {
  if (process.platform !== 'win32' || isDevelopmentApp()) return;
  // Portable builds have no installer to create the Start menu/AUMID registration.
  // Point at the stable portable launcher, not its temporary extracted executable.
  const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const shortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'CoursePilot.lnk');
  fs.mkdirSync(path.dirname(shortcut), { recursive: true });
  if (!shell.writeShortcutLink(shortcut, 'create', {
    target, cwd: path.dirname(target), appUserModelId: APP_ID,
    description: 'CoursePilot 课表与作业管理', icon: target, iconIndex: 0,
  })) throw new Error('无法注册 Windows 通知，请检查开始菜单快捷方式目录是否可写');
}

function openAssignments() {
  showMainWindow('assignments');
}

function handleNotificationClick(_assignmentId, payload) {
  if (payload?.target === 'today') {
    showMainWindow('today');
    return;
  }
  openAssignments();
}

function getDesktopSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function loadDesktopSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(getDesktopSettingsPath(), 'utf8'));
    desktopSettings = data && typeof data === 'object' ? data : {};
  } catch (error) {
    desktopSettings = {};
  }
  closeAction =
    desktopSettings.closeAction === 'tray' || desktopSettings.closeAction === 'quit'
      ? desktopSettings.closeAction
      : null;
}

function saveDesktopSettings(patch) {
  desktopSettings = { ...desktopSettings, ...patch };
  try {
    const target = getDesktopSettingsPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(desktopSettings, null, 2), 'utf8');
  } catch (error) {
    console.warn('[CoursePilot] 保存桌面设置失败', error);
  }
}

function getLaunchPath() {
  // Portable builds run from a temporary extraction directory; register the stable launcher instead.
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function loginItemOptions() {
  return { path: getLaunchPath(), args: ['--hidden'] };
}

function readAutoLaunchState() {
  if (process.platform !== 'win32') return { supported: false, enabled: false };
  if (isDevelopmentApp()) return { supported: false, enabled: false };
  try {
    return {
      supported: true,
      enabled: Boolean(app.getLoginItemSettings(loginItemOptions()).openAtLogin),
      path: getLaunchPath(),
    };
  } catch (error) {
    return { supported: true, enabled: false, error: error.message };
  }
}

function applyAutoLaunch(enabled) {
  if (process.platform !== 'win32') throw new Error('仅 Windows 支持开机自启动');
  if (isDevelopmentApp()) throw new Error('开机自启动仅在打包版可用');
  app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: Boolean(enabled) });
  const actual = Boolean(app.getLoginItemSettings(loginItemOptions()).openAtLogin);
  if (actual !== Boolean(enabled)) {
    throw new Error(enabled ? '系统未能启用开机自启动' : '系统未能关闭开机自启动');
  }
  saveDesktopSettings({ autoLaunch: Boolean(enabled) });
  broadcastDesktopPreferences();
  return actual;
}

function broadcastDesktopPreferences() {
  const payload = { miniVisible, autoLaunch: readAutoLaunchState() };
  for (const win of [mainWindow, miniWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('desktop-preferences-changed', payload);
  }
}

function loadAppIcon() {
  try {
    return nativeImage.createFromBuffer(
      fs.readFileSync(path.join(__dirname, 'assets', 'icon.png'))
    );
  } catch (error) {
    return null;
  }
}

function loadTrayIcon() {
  try {
    return nativeImage
      .createFromBuffer(fs.readFileSync(path.join(__dirname, 'assets', 'tray-icon.png')))
      .resize({ width: 16, height: 16 });
  } catch (error) {
    return nativeImage.createEmpty();
  }
}

function showMainWindow(route) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(true);
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();

  if (!route) return;
  const contents = mainWindow.webContents;
  const navigate = () => {
    if (contents.isDestroyed()) return;
    contents
      .executeJavaScript(`window.location.hash = ${JSON.stringify(route)}`)
      .catch((error) => console.warn('[CoursePilot] 打开页面失败', error));
  };
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', navigate);
  else navigate();
}

function hideToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!tray) {
    quitApp();
    return;
  }
  mainWindow.hide();
  if (!trayBalloonShown && process.platform === 'win32') {
    trayBalloonShown = true;
    try {
      tray.displayBalloon({
        title: 'CoursePilot 仍在运行',
        content: '已最小化到托盘，作业提醒会继续运行。双击托盘图标可恢复窗口。',
        iconType: 'info',
      });
    } catch (error) {
      console.warn('[CoursePilot] 托盘气泡提示失败', error);
    }
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主界面', click: () => showMainWindow('schedule') },
      { label: '查看作业', click: () => showMainWindow('assignments') },
      {
        label: '迷你悬浮窗',
        type: 'checkbox',
        checked: miniVisible,
        click: () => toggleMiniWindow(),
      },
      { type: 'separator' },
      {
        label: '关闭窗口时重新选择',
        click: () => {
          closeAction = null;
          saveDesktopSettings({ closeAction: null });
        },
      },
      { type: 'separator' },
      { label: '退出 CoursePilot', click: () => quitApp() },
    ])
  );
}

function createTray() {
  if (tray) return;
  tray = new Tray(loadTrayIcon());
  tray.setToolTip('CoursePilot · 课表与作业');
  tray.on('double-click', () => showMainWindow());
  rebuildTrayMenu();
}

const MINI_WIDTH = 348;
const MINI_HEIGHT = 176;

function getDefaultMiniBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - MINI_WIDTH - 18,
    y: workArea.y + workArea.height - MINI_HEIGHT - 18,
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
  };
}

function normalizeMiniBounds(saved) {
  const fallback = getDefaultMiniBounds();
  if (!saved || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(saved[key])))) {
    return fallback;
  }
  const width = Math.min(Math.max(Number(saved.width), 300), 460);
  const height = Math.min(Math.max(Number(saved.height), 140), 240);
  const bounds = {
    x: Math.round(Number(saved.x)),
    y: Math.round(Number(saved.y)),
    width,
    height,
  };
  const visible = screen.getAllDisplays().some(({ workArea }) =>
    bounds.x < workArea.x + workArea.width &&
    bounds.x + width > workArea.x &&
    bounds.y < workArea.y + workArea.height &&
    bounds.y + height > workArea.y
  );
  return visible ? bounds : fallback;
}

function saveMiniBounds() {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const [x, y] = miniWindow.getPosition();
  const [width, height] = miniWindow.getSize();
  saveDesktopSettings({ miniBounds: { x, y, width, height } });
}

function scheduleSaveMiniBounds() {
  clearTimeout(miniMoveTimer);
  miniMoveTimer = setTimeout(() => {
    miniMoveTimer = null;
    saveMiniBounds();
  }, 300);
}

function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow;
  const bounds = normalizeMiniBounds(desktopSettings.miniBounds);
  miniWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    title: 'CoursePilot 悬浮窗',
    icon: appIcon || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  miniWindow.setAlwaysOnTop(true, 'floating');
  miniWindow.loadURL(`${WINDOW_URL}#mini`);
  miniWindow.once('ready-to-show', () => {
    if (miniVisible) miniWindow.showInactive();
  });
  miniWindow.on('moved', scheduleSaveMiniBounds);
  miniWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideMiniWindow();
  });
  miniWindow.on('closed', () => {
    miniWindow = null;
  });
  return miniWindow;
}

function showMiniWindow() {
  if (!accountStore?.currentUser()) return false;
  miniVisible = true;
  const win = createMiniWindow();
  if (!win.webContents.isLoadingMainFrame()) win.showInactive();
  saveDesktopSettings({ miniVisible: true });
  rebuildTrayMenu();
  broadcastDesktopPreferences();
  return true;
}

function suspendMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    saveMiniBounds();
    miniWindow.destroy();
    miniWindow = null;
  }
  miniVisible = false;
  // Keep desktopSettings.miniVisible so the next login can restore the widget.
  rebuildTrayMenu();
  broadcastDesktopPreferences();
}

function resumeMiniWindow() {
  if (desktopSettings.miniVisible) showMiniWindow();
}

function hideMiniWindow() {
  miniVisible = false;
  if (miniWindow && !miniWindow.isDestroyed()) {
    saveMiniBounds();
    miniWindow.hide();
  }
  saveDesktopSettings({ miniVisible: false });
  rebuildTrayMenu();
  broadcastDesktopPreferences();
}

function toggleMiniWindow() {
  if (miniVisible) hideMiniWindow();
  else showMiniWindow();
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(),
  });
  res.end(body);
}

function getDistDir() {
  return path.join(app.getAppPath(), 'dist');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('课表数据过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const distDir = getDistDir();
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, APP_ORIGIN).pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const hasExtension = Boolean(path.extname(pathname));
  if (pathname === '/' || !hasExtension) pathname = '/index.html';

  const relative = path.normalize(pathname).replace(/^[/\\]+/, '');
  const filePath = path.join(distDir, relative);
  const safePrefix = distDir.endsWith(path.sep) ? distDir : `${distDir}${path.sep}`;
  if (filePath !== distDir && !filePath.startsWith(safePrefix)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (!error && stat.isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    if (hasExtension) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const fallback = path.join(distDir, 'index.html');
    fs.readFile(fallback, (fallbackError, data) => {
      if (fallbackError) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  });
}

function createServer() {
  return new Promise((resolve, reject) => {
    const instance = http.createServer(async (req, res) => {
      let pathname = '/';
      try {
        pathname = new URL(req.url, APP_ORIGIN).pathname;
      } catch {
        res.writeHead(400);
        res.end('Bad Request');
        return;
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }

      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, app: 'coursepilot', version: app.getVersion() });
        return;
      }

      if (pathname === '/api/import' && req.method === 'POST') {
        try {
          const body = await readBody(req);
          const payload = JSON.parse(body);
          if (!payload || !Array.isArray(payload.sessions)) {
            sendJson(res, 400, { ok: false, error: '缺少 sessions 数组' });
            return;
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('neu-import', payload);
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }

          console.log(`[CoursePilot] 收到 ${payload.sessions.length} 个上课时段`);
          sendJson(res, 200, { ok: true, count: payload.sessions.length });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message || String(error) });
        }
        return;
      }

      if (req.method === 'GET') {
        serveStatic(req, res);
        return;
      }

      res.writeHead(405);
      res.end('Method Not Allowed');
    });

    instance.on('error', reject);
    instance.listen(APP_PORT, '127.0.0.1', () => resolve(instance));
  });
}

function findEdgePath() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter((candidate) => candidate && fs.existsSync(candidate));
  return candidates[0] || null;
}

function openSchool() {
  const edgePath = findEdgePath();
  if (edgePath) {
    try {
      spawn(edgePath, [SCHOOL_URL], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, browser: 'edge' };
    } catch (error) {
      console.warn('[CoursePilot] 启动 Edge 失败', error);
    }
  }

  shell.openExternal(SCHOOL_URL).catch(() => {});
  return { ok: true, browser: 'default' };
}

function createWindow(showWhenReady = true) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'CoursePilot · 课表助手',
    backgroundColor: '#f5f7fb',
    icon: appIcon || undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();

    if (closeAction === 'tray') {
      hideToTray();
      return;
    }
    if (closeAction === 'quit') {
      quitApp();
      return;
    }

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      title: '关闭 CoursePilot',
      message: '关闭窗口后要怎么做？',
      detail:
        '最小化到托盘后作业提醒会继续运行；退出软件后不再提醒。本次选择会记住，可在托盘菜单里重新选择。',
      buttons: ['最小化到托盘', '退出软件'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    const action = choice === 1 ? 'quit' : 'tray';
    closeAction = action;
    saveDesktopSettings({ closeAction: action });
    if (action === 'tray') hideToTray();
    else quitApp();
  });

  mainWindow.once('ready-to-show', () => {
    if (showWhenReady && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.loadURL(WINDOW_URL);
  const allowedOrigins = [APP_ORIGIN, DEV_SERVER_URL].filter(Boolean);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/([^/]+\.)?neu\.edu\.cn/i.test(url) || url.startsWith('http://219.216.96.4')) {
      openSchool();
    } else {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!allowedOrigins.some((origin) => url.startsWith(origin))) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('[CoursePilot] 页面加载失败', code, description);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (Array.isArray(argv) && argv.includes('--hidden')) return;
    showMainWindow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    loadDesktopSettings();
    try {
      accountStore = createAccountStore(getDataDir());
    } catch (error) {
      dialog.showErrorBox(
        '账号数据无法读取',
        `${error.message}\n\n请先备份数据目录中的 accounts.json，修复或恢复后再打开软件。`
      );
      app.quit();
      return;
    }
    appIcon = loadAppIcon();
    if (desktopSettings.autoLaunch) {
      try {
        applyAutoLaunch(true);
      } catch (error) {
        console.warn('[CoursePilot] 恢复开机自启动失败', error);
      }
    }
    try {
      createTray();
    } catch (error) {
      console.warn('[CoursePilot] 创建托盘失败', error);
    }
    ipcMain.handle('open-school', () => openSchool());
    const isTrustedWindowEvent = (event) => {
      const windows = [mainWindow, miniWindow].filter((win) => win && !win.isDestroyed());
      if (!windows.some((win) => win.webContents === event.sender)) return false;
      try {
        return new URL(event.senderFrame.url).origin === new URL(WINDOW_URL).origin;
      } catch {
        return false;
      }
    };
    const isMainWindowEvent = (event) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents !== event.sender) return false;
      try {
        return new URL(event.senderFrame.url).origin === new URL(WINDOW_URL).origin;
      } catch {
        return false;
      }
    };
    const databaseRequest = (operation) => (event, payload) => {
      try {
        if (!isTrustedWindowEvent(event)) {
          throw new Error('不允许此页面访问数据库');
        }
        const user = accountStore.currentUser();
        if (!user) throw new Error('请先登录');
        if (!database || databaseUserId !== user.id) {
          closeDatabase();
          database = openDatabase(accountStore.userDirFor(user.id));
          databaseUserId = user.id;
        }
        return { ok: true, ...operation(database, payload) };
      } catch (error) {
        if (error.message !== '请先登录') {
          console.error('[CoursePilot] 数据库操作失败', error);
        }
        return { ok: false, error: error.message || String(error) };
      }
    };
    ipcMain.handle('database-initialize', databaseRequest((db, payload) => db.initialize(payload)));
    ipcMain.handle('database-read', databaseRequest((db) => db.read()));
    ipcMain.handle('database-save', databaseRequest((db, payload) => {
      const result = db.save(payload?.state, payload?.revision);
      if (miniWindow && !miniWindow.isDestroyed()) {
        miniWindow.webContents.send('database-changed');
      }
      return result;
    }));
    ipcMain.handle('auth-status', (event) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: '不允许此页面访问账号' };
      return authStatusPayload();
    });
    ipcMain.handle('auth-register', (event, payload) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: '不允许此页面创建账号' };
      try {
        closeDatabase();
        accountStore.register(
          { username: payload?.username, password: payload?.password },
          { prepareUser: prepareFirstUserData }
        );
        resumeMiniWindow();
        return { ok: true, ...authStatusPayload() };
      } catch (error) {
        return { ok: false, error: error.message || String(error) };
      }
    });
    ipcMain.handle('auth-login', (event, payload) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: '不允许此页面登录' };
      try {
        closeDatabase();
        accountStore.login({ username: payload?.username, password: payload?.password });
        resumeMiniWindow();
        return { ok: true, ...authStatusPayload() };
      } catch (error) {
        return { ok: false, error: error.message || String(error) };
      }
    });
    ipcMain.handle('auth-logout', (event) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: '不允许此页面退出登录' };
      try {
        closeDatabase();
        accountStore.logout();
        suspendMiniWindow();
        return { ok: true, ...authStatusPayload() };
      } catch (error) {
        return { ok: false, error: error.message || String(error) };
      }
    });
    ipcMain.handle('auth-change-password', (event, payload) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: '不允许此页面修改密码' };
      try {
        accountStore.changePassword({
          currentPassword: payload?.currentPassword,
          newPassword: payload?.newPassword,
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message || String(error) };
      }
    });
    const materialRequest = (handler) => async (event, payload) => {
      try {
        if (!isMainWindowEvent(event)) throw new Error('不允许此页面访问课件');
        const userDir = currentMaterialsUserDir();
        return { ok: true, ...(await handler(userDir, payload)) };
      } catch (error) {
        console.error('[CoursePilot] 课件操作失败', error);
        return { ok: false, error: error.message || String(error) };
      }
    };
    ipcMain.handle('materials-pick', materialRequest(async (userDir, payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用');
      const courseId = payload?.courseId;
      if (typeof courseId !== 'string' || !courseId.trim()) throw new Error('课程无效');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择课件',
        buttonLabel: '添加课件',
        defaultPath: process.env.CPX_MATERIALS_DIR || undefined,
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '课件文件',
            extensions: ['doc', 'docx', 'ppt', 'pptx', 'pdf', 'png', 'jpg', 'jpeg'],
          },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { items: [], errors: [] };
      }
      return copyMaterialFiles({ filePaths: result.filePaths, courseId, userDir });
    }));
    ipcMain.handle('materials-open', materialRequest(async (userDir, payload) => {
      const fullPath = resolveStoredMaterial(userDir, payload?.storedPath);
      if (!fs.existsSync(fullPath)) throw new Error('课件文件不存在，可能已被移动或删除');
      if (!isMaterialExtension(path.extname(fullPath))) throw new Error('不支持的课件格式');
      const error = await shell.openPath(fullPath);
      if (error) throw new Error(error);
      return { opened: true };
    }));
    ipcMain.handle('materials-read-image', materialRequest((userDir, payload) =>
      readImageDataUrl(userDir, payload?.storedPath)
    ));
    ipcMain.handle('materials-delete', materialRequest((userDir, payload) => ({
      deleted: deleteMaterialFile(userDir, payload?.storedPath),
    })));
    ipcMain.handle('materials-delete-course', materialRequest((userDir, payload) => ({
      deleted: deleteCourseMaterials(userDir, payload?.courseId),
    })));
    ipcMain.handle('open-pathly', (event) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: '不允许此页面打开外部网站' };
      shell.openExternal('https://pathly.top').catch(() => {});
      return { ok: true };
    });
    ipcMain.handle('desktop-get-preferences', (event) => {
      if (!isTrustedWindowEvent(event)) return { ok: false, error: '不允许此页面访问桌面设置' };
      return {
        ok: true,
        isPackaged: !isDevelopmentApp(),
        platform: process.platform,
        autoLaunch: readAutoLaunchState(),
        miniVisible,
      };
    });
    ipcMain.handle('desktop-set-auto-launch', (event, enabled) => {
      if (!isTrustedWindowEvent(event)) return { ok: false, error: '不允许此页面修改桌面设置' };
      try {
        return { ok: true, enabled: applyAutoLaunch(Boolean(enabled)) };
      } catch (error) {
        return { ok: false, error: error.message || String(error) };
      }
    });
    ipcMain.handle('mini-window-show', (event) => {
      if (!isTrustedWindowEvent(event)) return { ok: false, error: '不允许此页面操作悬浮窗' };
      const shown = showMiniWindow();
      return shown
        ? { ok: true, visible: true }
        : { ok: false, error: '请先登录后再打开悬浮窗' };
    });
    ipcMain.handle('mini-window-hide', (event) => {
      if (!isTrustedWindowEvent(event)) return { ok: false, error: '不允许此页面操作悬浮窗' };
      hideMiniWindow();
      return { ok: true, visible: false };
    });
    ipcMain.handle('mini-window-toggle', (event) => {
      if (!isTrustedWindowEvent(event)) return { ok: false, error: '不允许此页面操作悬浮窗' };
      toggleMiniWindow();
      return miniVisible ? { ok: true, visible: true } : { ok: false, error: '请先登录后再打开悬浮窗' };
    });
    ipcMain.handle('open-main', (event, route) => {
      if (!isTrustedWindowEvent(event)) return { ok: false, error: '不允许此页面打开主界面' };
      const target = route === 'assignments' ? 'assignments' : route === 'schedule' ? 'schedule' : 'today';
      showMainWindow(target);
      return { ok: true };
    });
    let notificationRegistrationError = '';
    try { registerWindowsNotifications(); }
    catch (error) {
      notificationRegistrationError = error.message;
      console.warn('[CoursePilot] 通知注册失败', error);
    }
    notificationService = createNotificationService({ Notification, onClick: handleNotificationClick });
    ipcMain.handle('notify-assignment', (_event, payload) => {
      if (notificationRegistrationError) return { ok: false, error: notificationRegistrationError };
      return notificationService.notify(payload);
    });

    try {
      server = await createServer();
      console.log(`[CoursePilot] 本地服务已启动：${APP_ORIGIN}`);
    } catch (error) {
      if (error && error.code === 'EADDRINUSE') {
        dialog.showErrorBox(
          'CoursePilot 无法启动',
          `端口 ${APP_PORT} 已被占用，请关闭占用该端口的程序后重试。`
        );
      } else {
        dialog.showErrorBox('CoursePilot 无法启动', error?.message || String(error));
      }
      app.quit();
      return;
    }

    const authenticated = Boolean(accountStore.currentUser());
    createWindow(!startHidden || !tray || !authenticated);
    if (authenticated) resumeMiniWindow();
    app.on('activate', () => {
      showMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (isQuitting || !tray) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  clearTimeout(miniMoveTimer);
  miniMoveTimer = null;
  if (miniWindow && !miniWindow.isDestroyed()) {
    saveMiniBounds();
    miniWindow.destroy();
    miniWindow = null;
  }
  notificationService?.close();
  closeDatabase();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (server) {
    server.close();
    server = null;
  }
});
