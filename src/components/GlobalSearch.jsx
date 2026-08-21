import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * 全局搜索面板（Ctrl+Shift+F）：
 * 搜索所有集合中的 URL、请求名称、Header 值、参数值。
 * 结果列表显示请求名称、方法、URL、所属集合路径。
 * 点击结果跳转打开对应请求标签。
 */
export default function GlobalSearch({ collections, onClose, onOpenRequest }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  // ---- 建立可搜索索引：遍历所有集合中的请求节点 ----
  const index = useMemo(() => {
    const items = [];
    const walk = (node, path) => {
      const cur = [...path, node.name];
      for (const r of node.requests || []) {
        // 收集搜索文本：name, url, params, headers
        const searchTexts = [
          r.name || '',
          r.url || '',
          ...(r.params || []).map((p) => `${p.key || ''} ${p.value || ''}`),
          ...(r.headers || []).map((h) => `${h.key || ''} ${h.value || ''}`)
        ].join(' ').toLowerCase();
        items.push({
          request: r,
          name: r.name || r.url || '未命名请求',
          method: r.method || 'GET',
          url: r.url || '',
          path: cur.join(' › '),
          searchTexts
        });
      }
      for (const f of node.folders || []) walk(f, cur);
    };
    for (const c of collections) walk(c, []);
    return items;
  }, [collections]);

  const q = query.trim().toLowerCase();

  // ---- 搜索匹配 ----
  const results = useMemo(() => {
    if (!q) return [];
    return index
      .filter((item) => item.searchTexts.includes(q))
      .slice(0, 50);
  }, [index, q]);

  useEffect(() => { setCursor(0); }, [q]);

  // 光标项保持可见
  useEffect(() => {
    const el = listRef.current && listRef.current.children[cursor];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const pick = (item) => {
    onClose();
    onOpenRequest(item.request);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[cursor]) pick(results[cursor]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  /** 高亮匹配文本 */
  const highlight = (text) => {
    if (!q || !text) return text;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="gs-highlight">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  };

  const METHOD_COLORS = {
    GET: 'gs-method-get',
    POST: 'gs-method-post',
    PUT: 'gs-method-put',
    DELETE: 'gs-method-delete',
    PATCH: 'gs-method-patch',
    HEAD: 'gs-method-head',
    OPTIONS: 'gs-method-options'
  };

  return (
    <div className="global-search-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        className="global-search-panel"
        initial={{ opacity: 0, y: -16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        {/* 搜索输入框 */}
        <div className="gs-header">
          <div className="gs-input-wrap">
            <svg className="gs-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              className="gs-input"
              placeholder="搜索所有请求（名称、URL、参数、Header）…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
            />
            {q && (
              <span className="gs-count">{results.length}{results.length >= 50 ? '+' : ''} 条结果</span>
            )}
          </div>
        </div>

        {/* 结果列表 */}
        <div className="gs-results" ref={listRef}>
          {!q && (
            <div className="gs-empty">
              <div className="gs-empty-icon">🔍</div>
              <div>输入关键词搜索所有请求</div>
              <div className="gs-empty-hint">支持匹配请求名称、URL、参数、Header 值</div>
            </div>
          )}
          {q && results.length === 0 && (
            <div className="gs-empty">
              <div className="gs-empty-icon">😶</div>
              <div>未找到匹配结果</div>
              <div className="gs-empty-hint">尝试不同的关键词</div>
            </div>
          )}
          {results.map((item, i) => (
            <div
              key={`${item.request.id}-${i}`}
              className={`gs-result-item ${i === cursor ? 'gs-result-item-active' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
            >
              <span className={`gs-method ${METHOD_COLORS[item.method] || ''}`}>
                {item.method}
              </span>
              <div className="gs-result-content">
                <div className="gs-result-name">{highlight(item.name)}</div>
                <div className="gs-result-url">{highlight(item.url)}</div>
              </div>
              <span className="gs-result-path" title={item.path}>{item.path}</span>
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <div className="gs-footer">
          <span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span>
        </div>
      </motion.div>
    </div>
  );
}
