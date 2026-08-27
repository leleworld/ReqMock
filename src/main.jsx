import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import App from './App.jsx';
import './styles.css';

// 浏览器模式 stub：window.api 由 Electron preload 注入，纯浏览器中不存在
if (!window.api) {
  const noop = () => {};
  const noopAsync = async () => ({});
  const noopOn = () => noop; // 返回 unsubscribe 函数
  window.api = new Proxy({}, {
    get(_, prop) {
      // on* 类回调返回取消订阅函数
      if (typeof prop === 'string' && prop.startsWith('on')) return noopOn;
      // load/save 类返回空数据
      if (prop === 'loadStore') return async () => ({ collections: [], environments: [], globals: [], tabs: [], settings: {}, history: [] });
      if (prop === 'saveStore') return noopAsync;
      if (prop === 'importFile') return async () => ({ canceled: true });
      if (prop === 'exportFile') return async () => ({ canceled: true });
      if (prop === 'getVersion') return async () => '0.1.0-browser';
      if (prop === 'newWindow') return noop;
      // 默认返回 async noop
      return noopAsync;
    }
  });
}

// 仅开发模式：URL 带 ?rtsim=1 时模拟主进程推送 WS/SSE 事件流（含断线重连剧本），供浏览器 UI 回归
if (import.meta.env.DEV && /[?&]rtsim=1/.test(window.location.search)) {
  const listeners = { 'ws:event': [], 'sse:event': [] };
  const emit = (ch, evt) => listeners[ch].slice().forEach((f) => f(evt));
  const timers = new Map();
  const now = () => Date.now();
  const sim = {
    wsConnect: async ({ id }) => {
      emit('ws:event', { id, type: 'connecting', direction: 'sys', data: '正在连接 ws://sim.local/stream', time: now() });
      const t0 = setTimeout(() => emit('ws:event', { id, type: 'open', direction: 'sys', data: '已连接 ws://sim.local/stream', time: now() }), 600);
      let n = 0;
      const t = setInterval(() => {
        n += 1;
        emit('ws:event', {
          id, type: 'message', direction: 'in', time: now(),
          data: n % 3 === 0 ? JSON.stringify({ seq: n, msg: '模拟推送', metrics: { qps: n * 12 } }) : `模拟消息 #${n}`
        });
      }, 800);
      timers.set(id, [t0, t]);
      return { ok: true };
    },
    wsSend: async (id, data) => {
      emit('ws:event', { id, type: 'message', direction: 'out', data, time: now() });
      return { ok: true };
    },
    wsClose: async (id) => {
      (timers.get(id) || []).forEach(clearTimeout);
      timers.delete(id);
      emit('ws:event', { id, type: 'close', direction: 'sys', data: '连接已关闭（code 1000）', time: now() });
      return { ok: true };
    },
    sseConnect: async ({ id }) => {
      emit('sse:event', { id, type: 'connecting', direction: 'sys', data: '正在连接 http://sim.local/events', time: now() });
      const t0 = setTimeout(() => emit('sse:event', { id, type: 'open', direction: 'sys', data: '已连接 http://sim.local/events（HTTP 200）', time: now() }), 400);
      let n = 0;
      const t = setInterval(() => {
        n += 1;
        if (n === 6) {
          // 断线重连剧本：close → reconnecting → connecting → open
          emit('sse:event', { id, type: 'close', direction: 'sys', data: '服务端关闭了连接', time: now() });
          emit('sse:event', { id, type: 'reconnecting', direction: 'sys', data: '连接中断，3.0s 后自动重连（第 1/10 次）', time: now() });
          const t1 = setTimeout(() => {
            emit('sse:event', { id, type: 'connecting', direction: 'sys', data: '重连中（第 1 次），Last-Event-ID=5', time: now() });
            const t2 = setTimeout(() => emit('sse:event', { id, type: 'open', direction: 'sys', data: '已连接 http://sim.local/events（HTTP 200）', time: now() }), 500);
            timers.get(id)?.push(t2);
          }, 800);
          timers.get(id)?.push(t1);
          return;
        }
        emit('sse:event', { id, type: 'message', direction: 'in', time: now(), event: n % 2 ? 'ticker' : 'message', lastEventId: String(n), data: JSON.stringify({ seq: n, temp: 20 + n }) });
      }, 900);
      timers.set(id, [t0, t]);
      return { ok: true };
    },
    sseClose: async (id) => {
      (timers.get(id) || []).forEach(clearTimeout);
      timers.delete(id);
      emit('sse:event', { id, type: 'close', direction: 'sys', data: '已断开连接', time: now() });
      return { ok: true };
    },
    onWsEvent: (cb) => {
      listeners['ws:event'].push(cb);
      return () => { listeners['ws:event'] = listeners['ws:event'].filter((f) => f !== cb); };
    },
    onSseEvent: (cb) => {
      listeners['sse:event'].push(cb);
      return () => { listeners['sse:event'] = listeners['sse:event'].filter((f) => f !== cb); };
    }
  };
  const orig = window.api;
  window.api = new Proxy({}, {
    get(_, prop) {
      if (sim[prop]) return sim[prop];
      return orig[prop];
    }
  });
}

createRoot(document.getElementById('root')).render(<App />);
