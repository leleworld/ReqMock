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

createRoot(document.getElementById('root')).render(<App />);
