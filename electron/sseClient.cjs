/**
 * SSE（Server-Sent Events）连接管理器（主进程）
 * 基于 node http/https 发起 Accept: text/event-stream 的流式 GET，
 * 逐行解析 event/data/id/retry 字段，事件通过 onEvent 回调上抛。
 * 事件结构：{ id, type, direction: 'in'|'sys', data, event?, lastEventId?, time }
 */
const http = require('http');
const https = require('https');

class SseManager {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.connections = new Map(); // id -> http.ClientRequest
  }

  emit(id, type, data, extra = {}, direction = 'sys') {
    this.onEvent({ id, type, direction, data: data ?? '', time: Date.now(), ...extra });
  }

  /** 建立 SSE 连接；同 id 已存在时先断开旧连接 */
  connect({ id, url, headers = [] }) {
    return this._connect({ id, url, headers, _redirectCount: 0 });
  }

  _connect({ id, url, headers = [], _redirectCount = 0 }) {
    if (!id || !url) return { ok: false, error: '缺少连接 id 或 URL' };
    if (_redirectCount === 0) this.close(id);
    if (_redirectCount > 5) { this.emit(id, 'error', 'SSE 重定向次数超过上限'); return { ok: false, error: '重定向过多' }; }
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (e) {
      return { ok: false, error: 'URL 非法: ' + url };
    }
    const isHttps = urlObj.protocol === 'https:';
    const reqHeaders = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
    for (const h of headers) {
      if (h && h.enabled !== false && h.key) reqHeaders[h.key] = h.value ?? '';
    }

    const mod = isHttps ? https : http;
    const req = mod.request({
      method: 'GET',
      host: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      headers: reqHeaders
    }, (res) => {
      // 跟随 3xx 重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy();
        this.connections.delete(id);
        this._connect({ id, url: new URL(res.headers.location, url).toString(), headers, _redirectCount: _redirectCount + 1 });
        return;
      }
      if (res.statusCode !== 200) {
        this.emit(id, 'error', `服务端返回 HTTP ${res.statusCode}`);
        this.close(id);
        return;
      }
      this.emit(id, 'open', `已连接 ${url}（HTTP ${res.statusCode}）`);
      res.setEncoding('utf8');
      // SSE 帧解析：以空行分隔事件块，块内逐行取 event/data/id/retry
      let buffer = '';
      let cur = { event: '', data: [], lastEventId: '' };
      const flush = () => {
        if (cur.data.length) {
          this.emit(id, 'message', cur.data.join('\n'), {
            event: cur.event || 'message',
            lastEventId: cur.lastEventId
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
          else if (field === 'retry') this.emit(id, 'retry', value);
        }
      });
      res.on('end', () => {
        flush();
        this.connections.delete(id);
        this.emit(id, 'close', '服务端关闭了连接');
      });
      res.on('error', (e) => this.emit(id, 'error', e.message));
    });

    req.on('error', (e) => {
      this.connections.delete(id);
      this.emit(id, 'error', e.message);
    });
    this.connections.set(id, req);
    req.end();
    return { ok: true };
  }

  close(id) {
    const req = this.connections.get(id);
    if (!req) return { ok: false };
    this.connections.delete(id);
    try { req.destroy(); } catch (e) { /* 已销毁 */ }
    return { ok: true };
  }

  /** 关闭全部连接（窗口关闭 / 应用退出时清理） */
  closeAll() {
    for (const id of [...this.connections.keys()]) this.close(id);
  }
}

module.exports = { SseManager };
