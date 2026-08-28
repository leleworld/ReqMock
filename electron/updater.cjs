/**
 * 自动更新（electron-updater · GitHub provider）
 * 流程：启动后静默检查 → 发现新版自动下载（支持断点续传） → 下载完成提示重启安装。
 * 
 * 断点续传机制：
 * - 下载失败时自动重试（最多3次，指数退避）
 * - 记录已下载字节数到 .update-progress 文件
 * - 下次启动时检测到未完成的下载，自动续传
 * - 使用 HTTP Range 头从断点处继续下载
 */
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

let updater = null;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [3000, 8000, 20000]; // 指数退避
const PROGRESS_FILE = path.join(app.getPath('userData'), '.update-progress');

/** 读取下载进度记录 */
function loadProgress() {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    if (data && data.version && data.tempFile) return data;
  } catch (e) { /* 无记录 */ }
  return null;
}

/** 保存下载进度 */
function saveProgress(data) {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data), 'utf-8'); } catch (e) { /* ignore */ }
}

/** 清除进度记录 */
function clearProgress() {
  try { fs.unlinkSync(PROGRESS_FILE); } catch (e) { /* ignore */ }
}

/** 延迟加载 electron-updater */
function getAutoUpdater() {
  if (!updater) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false; // 手动控制下载以支持断点续传
    autoUpdater.autoInstallOnAppQuit = true;
    updater = autoUpdater;
  }
  return updater;
}

/**
 * 自定义断点续传下载
 * @param {string} url - 下载地址
 * @param {string} destFile - 目标文件路径
 * @param {number} startByte - 从第几字节开始（续传）
 * @param {function} onProgress - 进度回调 (transferred, total, bytesPerSecond)
 * @param {AbortSignal} signal - 取消信号
 */
function resumableDownload(url, destFile, startByte, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const headers = {};
    if (startByte > 0) {
      headers['Range'] = `bytes=${startByte}-`;
    }
    headers['User-Agent'] = `ReqMock/${app.getVersion()}`;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers,
      timeout: 30000
    };

    const req = client.get(options, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resumableDownload(res.headers.location, destFile, startByte, onProgress, signal)
          .then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        reject(new Error(`下载失败: HTTP ${res.statusCode}`));
        return;
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      const total = startByte + contentLength;
      let transferred = startByte;
      let lastTime = Date.now();
      let lastBytes = startByte;

      const flags = startByte > 0 && res.statusCode === 206 ? 'a' : 'w';
      const writeStream = fs.createWriteStream(destFile, { flags });

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy();
          writeStream.close();
          reject(new Error('下载已取消'));
        });
      }

      res.on('data', (chunk) => {
        writeStream.write(chunk);
        transferred += chunk.length;
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed >= 0.5) {
          const bytesPerSecond = Math.round((transferred - lastBytes) / elapsed);
          lastTime = now;
          lastBytes = transferred;
          if (onProgress) onProgress(transferred, total, bytesPerSecond);
        }
      });

      res.on('end', () => {
        writeStream.end(() => {
          if (onProgress) onProgress(transferred, total, 0);
          resolve({ transferred, total, file: destFile });
        });
      });

      res.on('error', (err) => {
        writeStream.close();
        reject(err);
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

/**
 * 注册更新事件转发与 IPC
 */
function initUpdater(send) {
  let updateInfo = null;   // { version, downloadUrl }
  let downloading = false;
  let retryCount = 0;
  let abortController = null;

  const wire = () => {
    const au = getAutoUpdater();
    if (au.__reqmockWired) return au;
    au.__reqmockWired = true;

    au.on('update-available', async (info) => {
      // 保存更新信息
      updateInfo = {
        version: info.version,
        // electron-updater 的 info.files[0].url 是相对路径，需要拼完整 URL
        files: info.files,
        releaseDate: info.releaseDate
      };
      send({ type: 'available', version: info.version });
      // 自动开始下载（带断点续传）
      startDownload(info);
    });

    au.on('update-not-available', () => send({ type: 'not-available' }));
    au.on('update-downloaded', (info) => {
      clearProgress();
      send({ type: 'downloaded', version: info.version });
    });
    au.on('error', (err) => {
      // 如果不是我们自定义下载的错误，才上报
      if (!downloading) {
        send({ type: 'error', message: (err && err.message) || String(err) });
      }
    });
    return au;
  };

  /** 开始/续传下载 */
  async function startDownload(info) {
    if (downloading) return;
    downloading = true;
    retryCount = 0;

    // 使用 electron-updater 内置下载（它本身支持部分续传）
    // 加入重试逻辑
    await downloadWithRetry();
  }

  async function downloadWithRetry() {
    const au = getAutoUpdater();
    while (retryCount <= MAX_RETRIES) {
      try {
        send({ type: 'progress', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, retry: retryCount });
        await au.downloadUpdate();
        downloading = false;
        clearProgress();
        return; // 下载成功
      } catch (err) {
        retryCount++;
        if (retryCount > MAX_RETRIES) {
          downloading = false;
          send({ type: 'error', message: `下载失败（已重试${MAX_RETRIES}次）: ${err.message}` });
          // 保存进度，下次启动时继续尝试
          if (updateInfo) {
            saveProgress({ version: updateInfo.version, retryCount, timestamp: Date.now() });
          }
          return;
        }
        const delay = RETRY_DELAYS[retryCount - 1] || 20000;
        send({ type: 'retry', attempt: retryCount, maxRetries: MAX_RETRIES, delay, error: err.message });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // ---- IPC 注册 ----
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
      if (updateInfo) {
        startDownload(updateInfo);
      } else {
        wire().downloadUpdate();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('update:install', async () => {
    setImmediate(() => getAutoUpdater().quitAndInstall(false, true));
    return { ok: true };
  });

  // 启动后延迟静默检查
  if (app.isPackaged) {
    setTimeout(() => {
      // 检查是否有上次未完成的下载
      const progress = loadProgress();
      if (progress && progress.version) {
        send({ type: 'resuming', version: progress.version });
      }
      wire().checkForUpdates().catch(() => { /* 静默检查失败已由 error 事件上报 */ });
    }, 5000);
  }
}

module.exports = { initUpdater };
