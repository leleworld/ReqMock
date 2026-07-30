import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { TOOLS } from './ToolsPanel.jsx';

/**
 * 全局搜索 / 命令面板（Ctrl+K）：
 * 跨集合请求、历史记录、环境、Mock 路由、工具与常用命令的统一入口。
 * 无关键字时展示命令与最近历史；有关键字时按名称/URL/路径模糊匹配。
 */
export default function CommandPalette(props) {
  const {
    collections, environments, history, mock,
    onClose, onOpenRequest, onOpenEnv, onSelectRoute,
    onOpenTool, onNewTab, onOpenMock, onOpenCookies,
    onOpenSettings, onActivateEnv, activeEnvId
  } = props;

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  // ---- 建立可搜索索引 ----
  const index = useMemo(() => {
    const items = [];
    // 命令
    items.push(
      { type: 'command', label: '新建请求标签', hint: 'Ctrl+T', run: () => onNewTab() },
      { type: 'command', label: '打开 Mock 服务面板', run: () => onOpenMock() },
      { type: 'command', label: '打开 Cookie 管理器', run: () => onOpenCookies() },
      { type: 'command', label: '打开设置', run: () => onOpenSettings() }
    );
    for (const env of environments) {
      items.push({
        type: 'command',
        label: `切换环境：${env.name}${env.id === activeEnvId ? '（当前）' : ''}`,
        run: () => onActivateEnv(env.id)
      });
    }
    // 集合请求（带路径）
    const walk = (node, path) => {
      const cur = [...path, node.name];
      for (const r of node.requests || []) {
        items.push({
          type: 'request', label: r.name || r.url, sub: cur.join(' › '),
          method: r.method, url: r.url, run: () => onOpenRequest(r)
        });
      }
      for (const f of node.folders || []) walk(f, cur);
    };
    for (const c of collections) walk(c, []);
    // 环境
    for (const env of environments) {
      items.push({ type: 'env', label: env.name, sub: '环境变量', run: () => onOpenEnv(env.id) });
    }
    // Mock 路由
    for (const route of mock.routes || []) {
      items.push({
        type: 'mock', label: route.name || route.path, sub: `Mock ${route.path}`,
        method: route.method, run: () => onSelectRoute(route.id)
      });
    }
    // 工具
    for (const t of TOOLS) {
      items.push({ type: 'tool', label: t.label, sub: t.desc, run: () => onOpenTool(t.key) });
    }
    // 历史（最近 20 条）
    for (const h of (history || []).slice(0, 20)) {
      items.push({
        type: 'history', label: h.url || '(空)', sub: `历史 · ${String(h.status)}`,
        method: h.method, run: () => onOpenRequest(h)
      });
    }
    return items;
  }, [collections, environments, history, mock, activeEnvId]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) {
      // 默认视图：命令 + 最近历史
      return index.filter((it) => it.type === 'command' || it.type === 'history').slice(0, 15);
    }
    const score = (it) => {
      const label = (it.label || '').toLowerCase();
      const sub = (it.sub || '').toLowerCase();
      const url = (it.url || '').toLowerCase();
      if (label.startsWith(q)) return 0;
      if (label.includes(q)) return 1;
      if (url.includes(q)) return 2;
      if (sub.includes(q)) return 3;
      return -1;
    };
    return index
      .map((it) => ({ it, s: score(it) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s)
      .slice(0, 50)
      .map((x) => x.it);
  }, [index, q]);

  useEffect(() => { setCursor(0); }, [q]);

  // 光标项保持可见
  useEffect(() => {
    const el = listRef.current && listRef.current.children[cursor];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const pick = (item) => {
    onClose();
    item.run();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[cursor]) pick(shown[cursor]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const TYPE_TAG = {
    command: '命令', request: '请求', env: '环境', mock: 'Mock', tool: '工具', history: '历史'
  };

  return (
    <div className="palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        className="palette"
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="搜索请求 / 历史 / 环境 / Mock / 工具，或输入命令…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        <div className="palette-list" ref={listRef}>
          {shown.length === 0 && <div className="palette-empty">无匹配结果</div>}
          {shown.map((item, i) => (
            <div
              key={`${item.type}-${item.label}-${i}`}
              className={`palette-item ${i === cursor ? 'palette-item-active' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
            >
              <span className={`palette-tag palette-tag-${item.type}`}>{TYPE_TAG[item.type]}</span>
              {item.method && <span className={`method method-${item.method}`}>{item.method}</span>}
              <span className="palette-label" title={item.url || item.label}>{item.label}</span>
              {item.sub && <span className="palette-sub">{item.sub}</span>}
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
        <div className="palette-footer">
          <span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span>
        </div>
      </motion.div>
    </div>
  );
}
