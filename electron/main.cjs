const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createNotificationService } = require('./notifications.cjs');

const APP_PORT = 17890;
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

if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
}

function registerWindowsNotifications() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
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
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'CoursePilot · 课表助手',
    backgroundColor: '#f5f7fb',
    icon: appIcon || undefined,
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
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    loadDesktopSettings();
    appIcon = loadAppIcon();
    try {
      createTray();
    } catch (error) {
      console.warn('[CoursePilot] 创建托盘失败', error);
    }
    ipcMain.handle('open-school', () => openSchool());
    let notificationRegistrationError = '';
    try { registerWindowsNotifications(); }
    catch (error) {
      notificationRegistrationError = error.message;
      console.warn('[CoursePilot] 通知注册失败', error);
    }
    notificationService = createNotificationService({ Notification, onClick: openAssignments });
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

    createWindow();
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
  notificationService?.close();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (server) {
    server.close();
    server = null;
  }
});
