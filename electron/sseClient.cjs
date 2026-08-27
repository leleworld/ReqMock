/**
 * SSE（Server-Sent Events）连接管理器（主进程）
 * 基于 node http/https 发起 Accept: text/event-stream 的流式 GET，
 * 逐行解析 event/data/id/retry 字段，事件通过 onEvent 回调上抛。
 * 事件结构：{ id, type, direction: 'in'|'sys', data, event?, lastEventId?, time }
 * type 含：connecting / open / message / retry / reconnecting / close / error
 * 支持断线自动重连：非手动关闭时按 retry 字段（缺省 3s）指数退避（封顶 15s、最多 10 次），
 * 重连请求携带 Last-Event-ID，让服务端可从断点续推。
 */
const http = require('http');
const https = require('https');

const RECONNECT_MAX_ATTEMPTS = 10;
const RECONNECT_BASE_MS = 3000;
const RECONNECT_CAP_MS = 15000;

class SseManager {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.connections = new Map(); // id -> { req, url, headers, autoReconnect, lastEventId, retryMs, attempts, closing, timer }
  }

  emit(id, type, data, extra = {}, direction = 'sys') {
    this.onEvent({ id, type, direction, data: data ?? '', time: Date.now(), ...extra });
  }

  /** 建立 SSE 连接；同 id 已存在时先断开旧连接 */
  connect({ id, url, headers = [], autoReconnect = true }) {
    if (!id || !url) return { ok: false, error: '缺少连接 id 或 URL' };
    this.close(id);
    const rec = {
      url, headers, autoReconnect,
      lastEventId: '', retryMs: RECONNECT_BASE_MS,
      attempts: 0, closing: false, req: null, timer: null
    };
    this.connections.set(id, rec);
    this._open(id, rec, 0);
    return { ok: true };
  }

  /** 真正发起一次请求；redirectCount 防止重定向死循环 */
  _open(id, rec, redirectCount = 0) {
    if (rec.closing) return;
    let urlObj;
    try {
      urlObj = new URL(rec.url);
    } catch (e) {
      this.emit(id, 'error', 'URL 非法: ' + e.message);
      this._scheduleReconnect(id, rec);
      return;
    }
    const isHttps = urlObj.protocol === 'https:';
    const reqHeaders = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
    for (const h of rec.headers) {
      if (h && h.enabled !== false && h.key) reqHeaders[h.key] = h.value ?? '';
    }
    // 断点续推：携带上一次收到的事件 id
    if (rec.lastEventId) reqHeaders['Last-Event-ID'] = rec.lastEventId;

    this.emit(id, 'connecting', rec.attempts > 0 ? `重连中（第 ${rec.attempts} 次）${rec.lastEventId ? `，Last-Event-ID=${rec.lastEventId}` : ''}` : `正在连接 ${rec.url}`);

    const mod = isHttps ? https : http;
    const req = mod.request({
      method: 'GET',
      host: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      headers: reqHeaders
    }, (res) => {
      if (rec.closing) return;
      // 跟随 3xx 重定向（更新 rec.url 后原地重发，不计入退避）
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy();
        if (redirectCount >= 5) {
          this.emit(id, 'error', 'SSE 重定向次数超过上限');
          return;
        }
        rec.url = new URL(res.headers.location, rec.url).toString();
        this._open(id, rec, redirectCount + 1);
        return;
      }
      if (res.statusCode !== 200) {
        this.emit(id, 'error', `服务端返回 HTTP ${res.statusCode}`);
        this._scheduleReconnect(id, rec);
        return;
      }
      rec.attempts = 0; // 成功建立即重置退避
      this.emit(id, 'open', `已连接 ${rec.url}（HTTP ${res.statusCode}）`);
      res.setEncoding('utf8');
      // SSE 帧解析：以空行分隔事件块，块内逐行取 event/data/id/retry
      let buffer = '';
      let cur = { event: '', data: [], lastEventId: '' };
      const flush = () => {
        if (cur.data.length) {
          if (cur.lastEventId) rec.lastEventId = cur.lastEventId;
          this.emit(id, 'message', cur.data.join('\n'), {
            event: cur.event || 'message',
            lastEventId: cur.lastEventId || rec.lastEventId
          }, 'in');
        }
        cur = { event: '', data: [], lastEventId: cur.lastEventId };
      };
      res.on('data', (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (line === '') { flush(); continue; }
          if (line.startsWith(':')) continue; // 注释行（心跳）
          const ci = line.indexOf(':');
          const field = ci >= 0 ? line.slice(0, ci) : line;
          const value = ci >= 0 ? line.slice(ci + 1).replace(/^ /, '') : '';
          if (field === 'data') cur.data.push(value);
          else if (field === 'event') cur.event = value;
          else if (field === 'id') cur.lastEventId = value;
          else if (field === 'retry') {
            const ms = parseInt(value, 10);
            if (Number.isFinite(ms)) rec.retryMs = Math.min(Math.max(ms, 500), RECONNECT_CAP_MS);
            this.emit(id, 'retry', value);
          }
        }
      });
      res.on('end', () => {
        if (rec.closing) return;
        flush();
        this.emit(id, 'close', '服务端关闭了连接');
        this._scheduleReconnect(id, rec);
      });
      res.on('error', (e) => {
        if (rec.closing) return;
        this.emit(id, 'error', e.message);
        this._scheduleReconnect(id, rec);
      });
    });

    req.on('error', (e) => {
      if (rec.closing) return; // 手动断开触发的 abort 不算错误
      this.emit(id, 'error', e.message);
      this._scheduleReconnect(id, rec);
    });
    rec.req = req;
    req.end();
  }

  /** 断线后按退避计划重连；关闭了自动重连或达到次数上限则停止 */
  _scheduleReconnect(id, rec) {
    if (!rec.autoReconnect || rec.closing) return;
    if (this.connections.get(id) !== rec) return; // 已被新连接替换
    if (rec.attempts >= RECONNECT_MAX_ATTEMPTS) {
      this.emit(id, 'error', `自动重连已达上限（${RECONNECT_MAX_ATTEMPTS} 次），已停止`);
      return;
    }
    rec.attempts += 1;
    const delay = Math.min(rec.retryMs * Math.pow(2, rec.attempts - 1), RECONNECT_CAP_MS);
    this.emit(id, 'reconnecting', `连接中断，${(delay / 1000).toFixed(1)}s 后自动重连（第 ${rec.attempts}/${RECONNECT_MAX_ATTEMPTS} 次）`);
    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = setTimeout(() => {
      rec.timer = null;
      if (!rec.closing && this.connections.get(id) === rec) this._open(id, rec);
    }, delay);
  }

  close(id) {
    const rec = this.connections.get(id);
    if (!rec) return { ok: false };
    rec.closing = true;
    if (rec.timer) clearTimeout(rec.timer);
    this.connections.delete(id);
    try { if (rec.req) rec.req.destroy(); } catch (e) { /* 已销毁 */ }
    this.emit(id, 'close', '已断开连接');
    return { ok: true };
  }

  /** 关闭全部连接（窗口关闭 / 应用退出时清理） */
  closeAll() {
    for (const id of [...this.connections.keys()]) this.close(id);
  }
}

module.exports = { SseManager };
