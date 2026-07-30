/**
 * 自动更新（electron-updater · generic provider）
 * 更新源地址在 package.json build.publish 中配置，打包时由 electron-builder 写入 app-update.yml。
 * 流程：检查（启动自动 / 设置页手动）→ 渲染层确认后下载 → 下载完成提示重启安装。
 */
const { app, ipcMain } = require('electron');

let updater = null;

/** 延迟加载 electron-updater：开发模式不检查更新时完全不引入 */
function getAutoUpdater() {
  if (!updater) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false; // 由渲染层确认后再下载
    autoUpdater.autoInstallOnAppQuit = true; // 用户选择"稍后"时，退出应用自动完成安装
    updater = autoUpdater;
  }
  return updater;
}

/**
 * 注册更新事件转发与 IPC
 * @param {(evt: object) => void} send 把更新事件广播到全部渲染进程（channel: update:event）
 */
function initUpdater(send) {
  const wire = () => {
    const au = getAutoUpdater();
    if (au.__reqmockWired) return au;
    au.__reqmockWired = true;
    au.on('update-available', (info) => send({ type: 'available', version: info.version }));
    au.on('update-not-available', () => send({ type: 'not-available' }));
    au.on('download-progress', (p) => send({
      type: 'progress',
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    }));
    au.on('update-downloaded', (info) => send({ type: 'downloaded', version: info.version }));
    au.on('error', (err) => send({ type: 'error', message: (err && err.message) || String(err) }));
    return au;
  };

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { ok: false, reason: 'dev' };
    try {
      await wire().checkForUpdates();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('update:download', async () => {
    try {
      wire().downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('update:install', async () => {
    // 延迟到 IPC 回包后再退出安装，避免渲染进程 invoke 悬挂报错
    setImmediate(() => getAutoUpdater().quitAndInstall(false, true));
    return { ok: true };
  });

  // 启动后延迟静默检查一次（仅安装包环境；结果通过 update:event 通知渲染层）
  if (app.isPackaged) {
    setTimeout(() => {
      wire().checkForUpdates().catch(() => { /* 静默检查失败已由 error 事件上报 */ });
    }, 5000);
  }
}

module.exports = { initUpdater };
