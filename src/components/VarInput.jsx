import React, { useState, useRef } from 'react';
import { resolveVars, findUnresolvedVars } from '../utils/envUtil.js';

/**
 * 支持 {{变量}} 自动补全的输入框：
 * 输入 {{ 前缀时弹出变量建议，点击插入补全
 * highlight 开启后叠加彩色高亮层：'url' / true 为 URL 分色（query 键/值/分隔符/变量），
 * 'vars' 为纯 {{变量}} chip 高亮（适合 Header / 表单值等非 URL 场景）
 * 传入 varMap 后聚焦时显示「当前环境解析预览」气泡，补全列表附带变量当前值
 */
export default function VarInput({ value, onChange, varNames = [], varMap = null, className = '', highlight = false, ...rest }) {
  const [sug, setSug] = useState(null); // { prefix, items }
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const overlayRef = useRef(null);

  // 高亮层与输入框横向滚动同步，避免错位
  const syncScroll = () => {
    if (overlayRef.current && inputRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  const detect = (text, caret) => {
    if (!varNames.length) return null;
    const before = String(text ?? '').slice(0, caret);
    const m = before.match(/\{\{\s*([\w.-]*)$/);
    if (!m) return null;
    const items = varNames.filter((n) => n.startsWith(m[1])).slice(0, 12);
    return items.length ? { prefix: m[1], items } : null;
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    setSug(detect(e.target.value, e.target.selectionStart));
    requestAnimationFrame(syncScroll);
  };

  const insert = (name) => {
    const el = inputRef.current;
    const caret = el ? el.selectionStart : String(value ?? '').length;
    const before = String(value ?? '').slice(0, caret);
    const after = String(value ?? '').slice(caret);
    // 把 {{ 后已输入的前缀替换为完整变量名，并补 }}
    const newBefore = before.replace(/\{\{\s*[\w.-]*$/, `{{${name}}}`);
    const next = newBefore + (after.startsWith('}}') ? after.slice(2) : after);
    onChange(next);
    setSug(null);
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newBefore.length, newBefore.length);
      });
    }
  };

  const handleKeyDown = (e) => {
    if (sug && e.key === 'Tab') {
      e.preventDefault();
      insert(sug.items[0]);
      return;
    }
    if (sug && e.key === 'Escape') {
      setSug(null);
      return;
    }
    if (rest.onKeyDown) rest.onKeyDown(e);
  };

  const hlOn = highlight && !!String(value ?? '');

  // 当前环境解析预览：聚焦 + 含 {{变量}} 引用 + 未弹补全时显示
  const hasVarRef = /\{\{[^}]+\}\}/.test(String(value ?? ''));
  const previewOn = focused && !sug && !!varMap && hasVarRef;
  const resolved = previewOn ? resolveVars(String(value), varMap) : '';
  const missing = previewOn ? findUnresolvedVars(String(value), varMap) : [];

  return (
    <span className="var-input-wrap">
      {hlOn && (
        <span ref={overlayRef} className={`vi-overlay ${className}`} aria-hidden="true">
          {(highlight === 'vars' ? varTokens(value) : urlTokens(value)).map((tk, i) => (
            <span key={i} className={tk.c}>{tk.t}</span>
          ))}
        </span>
      )}
      <input
        {...rest}
        ref={inputRef}
        className={`${className}${hlOn ? ' vi-transparent' : ''}`}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onFocus={(e) => { setFocused(true); if (rest.onFocus) rest.onFocus(e); }}
        onBlur={(e) => {
          setFocused(false);
          setTimeout(() => setSug(null), 150);
          if (rest.onBlur) rest.onBlur(e);
        }}
      />
      {sug && (
        <div className="var-suggest">
          {sug.items.map((n) => (
            <div key={n} className="var-suggest-item" onMouseDown={(e) => { e.preventDefault(); insert(n); }}>
              <span>{'{{'}{n}{'}}'}</span>
              {varMap && n in varMap && <span className="var-suggest-val">{String(varMap[n])}</span>}
            </div>
          ))}
          <div className="var-suggest-hint">Tab 补全首项</div>
        </div>
      )}
      {previewOn && (
        <div className="var-preview">
          <span className="var-preview-label">当前环境解析结果</span>
          <span className="var-preview-value">{resolved || '（空）'}</span>
          {missing.length > 0 && (
            <span className="var-preview-missing">未定义变量：{missing.map((m) => `{{${m}}}`).join('  ')}</span>
          )}
        </div>
      )}
    </span>
  );
}

/** 纯变量高亮拆分：{{变量}} 着 chip 色，其余保持正文色 */
function varTokens(text) {
  const s = String(text ?? '');
  const out = [];
  const re = /\{\{[^}]*\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ t: s.slice(last, m.index), c: 'uh-plain' });
    out.push({ t: m[0], c: 'uh-var' });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last), c: 'uh-plain' });
  return out;
}

/** URL 拆分为着色片段：基础部分 / ? & = 分隔符 / query 键 / query 值 / {{变量}} */
function urlTokens(text) {
  const s = String(text ?? '');
  const out = [];
  // 把 {{var}} 从任意片段中单独切出来着变量色
  const pushVarAware = (str, cls) => {
    const re = /\{\{[^}]*\}\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) out.push({ t: str.slice(last, m.index), c: cls });
      out.push({ t: m[0], c: 'uh-var' });
      last = m.index + m[0].length;
    }
    if (last < str.length) out.push({ t: str.slice(last), c: cls });
  };

  const qi = s.indexOf('?');
  if (qi < 0) {
    pushVarAware(s, 'uh-base');
    return out;
  }
  pushVarAware(s.slice(0, qi), 'uh-base');
  out.push({ t: '?', c: 'uh-sep' });
  s.slice(qi + 1).split('&').forEach((pair, i) => {
    if (i > 0) out.push({ t: '&', c: 'uh-sep' });
    const ei = pair.indexOf('=');
    if (ei < 0) {
      pushVarAware(pair, 'uh-key');
    } else {
      pushVarAware(pair.slice(0, ei), 'uh-key');
      out.push({ t: '=', c: 'uh-sep' });
      pushVarAware(pair.slice(ei + 1), 'uh-val');
    }
  });
  return out;
}
