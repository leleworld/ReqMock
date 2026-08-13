/**
 * ReqMock 主进程入口
 * 职责：窗口管理、IPC 注册（请求发送 / Mock 服务 / 持久化）
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// GPU 加速自适应：检测上次是否因 GPU 崩溃退出，是则本次禁用 GPU
const gpuCrashFlag = path.join(app.getPath('userData'), '.gpu-crash');
if (fs.existsSync(gpuCrashFlag)) {
  // 上次 GPU 崩溃过，本次禁用 GPU 并清除标记（下次重新尝试）
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  try { fs.unlinkSync(gpuCrashFlag); } catch (e) { /* 忽略 */ }
}

const os = require('os');
const { spawn } = require('child_process');
const { sendHttpRequest } = require('./httpClient.cjs');
const { MockServer } = require('./mockServer.cjs');
const { WsManager } = require('./wsClient.cjs');
const { SseManager } = require('./sseClient.cjs');
const { Store } = require('./store.cjs');
const { initUpdater } = require('./updater.cjs');

let mainWindow = null;
let store = null;
let mockServer = null;
let wsManager = null;
let sseManager = null;

/* 与渲染层 themeUtil.js 的 THEMES.dark 标记保持同步：用于启动背景防闪 */
const DARK_THEMES = ['islands-dark', 'islands-darcula', 'high-contrast', 'dark', 'darcula'];

/** 启动背景色：读上次持久化的主题，浅色主题用浅底避免白屏前闪暗屏（读取失败按深色处理） */
function getStartupBackground() {
  try {
    const state = store ? store.load() : null;
    const theme = state && state.settings && state.settings.theme;
    if (theme && !DARK_THEMES.includes(theme)) return '#f7f8fa';
  } catch (e) { /* 忽略，回退深色 */ }
  return '#1e1f22';
}

/* 窗口状态持久化：记住位置/尺寸/最大化，重启后恢复（软件级窗口记忆） */
function windowStateFile() {
  return path.join(app.getPath('userData'), 'reqmock-window.json');
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(windowStateFile(), 'utf-8');
    const st = JSON.parse(raw);
    if (!st || typeof st.width !== 'number' || typeof st.height !== 'number') return null;
    // 校验窗口至少部分落在某个显示器工作区内，避免外接屏拔掉后窗口跑到屏外
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return st.x != null && st.y != null &&
        st.x < a.x + a.width && st.x + st.width > a.x &&
        st.y < a.y + a.height && st.y + st.height > a.y;
    });
    return { ...st, visible };
  } catch (e) {
    return null;
  }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const st = { maximized: win.isMaximized() };
    if (!st.maximized) Object.assign(st, win.getBounds());
    fs.writeFileSync(windowStateFile(), JSON.stringify(st), 'utf-8');
  } catch (e) { /* 窗口状态保存失败不影响主流程 */ }
}

function createWindow() {
  const winState = loadWindowState();
  const win = new BrowserWindow({
    ...(winState && winState.visible
      ? { x: winState.x, y: winState.y, width: winState.width, height: winState.height }
      : { width: 1440, height: 900 }),
    minWidth: 1024,
    minHeight: 640,
    title: 'ReqMock',
    backgroundColor: getStartupBackground(),
    icon: path.join(__dirname, '..', process.env.VITE_DEV_SERVER_URL ? 'public' : 'dist', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  if (winState && winState.maximized) win.maximize();
  win.on('close', () => saveWindowState(win));
  // 输入框右键编辑菜单：修复无应用菜单时输入框无法右键粘贴/复制的问题
  win.webContents.on('context-menu', (e, params) => {
    const f = params.editFlags || {};
    const tpl = [
      { role: 'undo', enabled: !!f.canUndo },
      { role: 'redo', enabled: !!f.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: !!f.canCut },
      { role: 'copy', enabled: !!f.canCopy },
      { role: 'paste', enabled: !!f.canPaste },
      { role: 'delete', enabled: params.editable },
      { type: 'separator' },
      { role: 'selectAll' }
    ];
    Menu.buildFromTemplate(tpl).popup({ window: win });
  });
  // 渲染层的 target=_blank 链接（如关于里的 GitHub）交给系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  if (!mainWindow) mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = BrowserWindow.getAllWindows()[0] || null; });
  return win;
}

function registerIpc() {
  // ---- 请求客户端 ----
  // 发送中的请求注册 AbortController，支持渲染进程按 cancelToken 主动取消
  const pendingRequests = new Map(); // cancelToken -> AbortController
  ipcMain.handle('request:send', async (event, payload) => {
    const { cancelToken, ...req } = payload || {};
    if (!cancelToken) return sendHttpRequest(req);
    const controller = new AbortController();
    pendingRequests.set(cancelToken, controller);
    try {
      return await sendHttpRequest(req, controller.signal);
    } finally {
      pendingRequests.delete(cancelToken);
    }
  });
  ipcMain.handle('request:cancel', async (event, cancelToken) => {
    const controller = pendingRequests.get(cancelToken);
    if (controller) {
      controller.abort();
      pendingRequests.delete(cancelToken);
      return { ok: true };
    }
    return { ok: false };
  });

  // ---- 持久化 ----
  ipcMain.handle('store:load', async () => store.load());
  ipcMain.handle('store:save', async (event, state) => store.save(state));

  // ---- Mock 服务 ----
  ipcMain.handle('mock:start', async (event, config) => {
    try {
      await mockServer.start(config);
      return { ok: true, port: config.port };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('mock:stop', async () => {
    await mockServer.stop();
    return { ok: true };
  });
  ipcMain.handle('mock:status', async () => mockServer.status());
  ipcMain.handle('mock:updateRoutes', async (event, routes) => {
    mockServer.updateRoutes(routes);
    return { ok: true };
  });

  // ---- WebSocket / SSE 实时连接 ----
  ipcMain.handle('ws:connect', async (event, config) => wsManager.connect(config));
  ipcMain.handle('ws:send', async (event, { id, data }) => wsManager.send(id, data));
  ipcMain.handle('ws:close', async (event, id) => wsManager.close(id));
  ipcMain.handle('sse:connect', async (event, config) => sseManager.connect(config));
  ipcMain.handle('sse:close', async (event, id) => sseManager.close(id));

  // ---- 文件导入 / 导出 ----
  ipcMain.handle('file:export', async (event, { defaultName, content, encoding }) => {
    // 按扩展名生成保存过滤器（支持 json/md/html/txt 等任意扩展名，响应体下载复用此通道）
    const ext = (((defaultName || '').match(/\.([a-z0-9]+)$/i) || [])[1] || 'json').toLowerCase();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出',
      defaultPath: defaultName || 'export.json',
      filters: [
        { name: ext.toUpperCase() + ' 文件', extensions: [ext] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      // encoding='base64' 时按二进制写入（图片等非文本响应体保存）
      if (encoding === 'base64') {
        fs.writeFileSync(result.filePath, Buffer.from(content || '', 'base64'));
      } else {
        fs.writeFileSync(result.filePath, content, 'utf-8');
      }
      return { ok: true, filePath: result.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('file:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入',
      properties: ['openFile'],
      filters: [{ name: '集合文件', extensions: ['json', 'yaml', 'yml', 'har', 'txt'] }, { name: '全部', extensions: ['*'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      return { ok: true, filePath: result.filePaths[0], content };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---- 选择本地文件（multipart 文件上传用，仅返回路径与大小） ----
  ipcMain.handle('file:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件',
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    try {
      const stat = fs.statSync(filePath);
      return { ok: true, filePath, name: path.basename(filePath), size: stat.size };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---- 新建窗口 ----
  ipcMain.handle('window:new', async () => {
    createWindow();
    return { ok: true };
  });

  // ---- 应用信息 / 编辑命令 / 开发者工具（自定义菜单栏用） ----
  ipcMain.handle('app:version', async () => app.getVersion());
  ipcMain.handle('edit:exec', async (event, command) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const wc = win && !win.isDestroyed() ? win.webContents : null;
    if (!wc || typeof wc[command] !== 'function') return { ok: false };
    wc[command]();
    return { ok: true };
  });
  ipcMain.handle('window:devtools', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed()) win.webContents.toggleDevTools();
    return { ok: true };
  });

  // ---- 脚本外部编辑：写临时文件用 VSCode 打开，监听保存后回传渲染进程 ----
  const scriptWatchers = new Map(); // token -> 临时文件路径
  ipcMain.handle('script:openExternal', async (event, { name, content }) => {
    try {
      const dir = path.join(os.tmpdir(), 'reqmock-scripts');
      fs.mkdirSync(dir, { recursive: true });
      const token = String(name || 'script').replace(/[^\w-]/g, '_') + '-' + Date.now();
      const file = path.join(dir, token + '.js');
      fs.writeFileSync(file, content || '', 'utf-8');
      // 优先用 VSCode 打开，不可用时回退系统默认编辑器
      const child = spawn('code', [file], { shell: true, detached: true, stdio: 'ignore' });
      child.on('error', () => shell.openPath(file));
      child.on('exit', (code) => { if (code !== 0) shell.openPath(file); });
      child.unref();
      const sender = event.sender;
      fs.watchFile(file, { interval: 500 }, () => {
        try {
          const text = fs.readFileSync(file, 'utf-8');
          if (!sender.isDestroyed()) sender.send('script:changed', { token, content: text });
        } catch (e) { /* 文件可能已被删除 */ }
      });
      scriptWatchers.set(token, file);
      return { ok: true, token, file };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('script:closeExternal', async (event, token) => {
    const file = scriptWatchers.get(token);
    if (file) {
      fs.unwatchFile(file);
      scriptWatchers.delete(token);
    }
    return { ok: true };
  });
}

app.whenReady().then(() => {
  // 监听 GPU 进程崩溃：写入标记文件，下次启动自动禁用 GPU
  app.on('child-process-gone', (event, details) => {
    if (details.type === 'GPU' || details.name === 'GPU') {
      try { fs.writeFileSync(gpuCrashFlag, String(Date.now()), 'utf-8'); } catch (e) { /* 忽略 */ }
    }
  });

  // 应用菜单仅保留系统编辑角色（mac 另加 appMenu），菜单 UI 由渲染层自定义集成菜单栏承担；
  // 不挂 windowMenu，避免其 Ctrl+W 等加速器拦截渲染层快捷键体系
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' }
  ]));
  store = new Store(path.join(app.getPath('userData'), 'reqmock-store.json'));
  mockServer = new MockServer((logEntry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mock:log', logEntry);
    }
  });
  // 实时连接事件统一推给全部窗口（按连接 id 在渲染层分发）
  const broadcast = (channel) => (evt) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, evt);
    }
  };
  wsManager = new WsManager(broadcast('ws:event'));
  sseManager = new SseManager(broadcast('sse:event'));
  // 自动更新：事件广播到全部窗口，渲染层负责确认下载/安装交互
  initUpdater(broadcast('update:event'));
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (mockServer) {
    mockServer.stop();
  }
  if (wsManager) wsManager.closeAll();
  if (sseManager) sseManager.closeAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
