/**
 * WebSocket 连接管理器（主进程）
 * 走主进程的原因：浏览器 WebSocket 无法自定义握手 Header，node 端 ws 可以。
 * 事件（open/message/close/error）通过构造时传入的 onEvent 回调上抛，
 * 事件结构：{ id, type, direction: 'in'|'out'|'sys', data, time }
 */
const WebSocket = require('ws');

class WsManager {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.connections = new Map(); // id -> WebSocket
  }

  emit(id, type, data, direction = 'sys') {
    this.onEvent({ id, type, direction, data: data ?? '', time: Date.now() });
  }

  /** 建立连接；同 id 已存在时先关闭旧连接 */
  connect({ id, url, headers = [], protocols = [] }) {
    if (!id || !url) return { ok: false, error: '缺少连接 id 或 URL' };
    this.close(id);
    const headerMap = {};
    for (const h of headers) {
      if (h && h.enabled !== false && h.key) headerMap[h.key] = h.value ?? '';
    }
    let ws;
    try {
      const protoList = (protocols || []).filter(Boolean);
      ws = new WebSocket(url, protoList.length ? protoList : undefined, { headers: headerMap });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    this.connections.set(id, ws);
    ws.on('open', () => this.emit(id, 'open', `已连接 ${url}`));
    ws.on('message', (data) => this.emit(id, 'message', data.toString(), 'in'));
    ws.on('close', (code, reason) => {
      this.connections.delete(id);
      this.emit(id, 'close', `连接已关闭（code ${code}${reason && reason.length ? '，' + reason.toString() : ''}）`);
    });
    ws.on('error', (e) => this.emit(id, 'error', e.message));
    return { ok: true };
  }

  /** 发送文本帧，未连接时返回错误 */
  send(id, data) {
    const ws = this.connections.get(id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return { ok: false, error: '连接未建立' };
    try {
      ws.send(String(data ?? ''));
      this.emit(id, 'message', String(data ?? ''), 'out');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  close(id) {
    const ws = this.connections.get(id);
    if (!ws) return { ok: false };
    this.connections.delete(id);
    try { ws.close(); } catch (e) { try { ws.terminate(); } catch (e2) { /* 已销毁 */ } }
    return { ok: true };
  }

  /** 关闭全部连接（窗口关闭 / 应用退出时清理） */
  closeAll() {
    for (const id of [...this.connections.keys()]) this.close(id);
  }
}

module.exports = { WsManager };
