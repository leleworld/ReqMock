import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  b64Encode, b64Decode, urlEncode, urlDecode,
  jsonEscape, jsonUnescape, unicodeEscape, unicodeUnescape,
  tsToDate, dateToTs, formatDate, genUuids
} from '../utils/toolboxUtil.js';
import { diffLines, diffStats, similarity, alignSideBySide } from '../utils/diffUtil.js';
import { JbIcon } from './Icons.jsx';

/** 工具清单：侧栏工具箱展示，每个工具在主区以独立标签页打开 */
export const TOOLS = [
  { key: 'codec', label: '编解码', icon: 'change', desc: 'Base64 / URL / JSON / Unicode' },
  { key: 'timestamp', label: '时间戳', icon: 'time', desc: '时间戳与日期互转' },
  { key: 'uuid', label: 'UUID', icon: 'dice', desc: '批量生成 UUID' },
  { key: 'diff', label: 'Diff 对比', icon: 'compare', desc: '文本差异逐行对比' }
];

const CODECS = [
  { key: 'base64', label: 'Base64', enc: b64Encode, dec: b64Decode },
  { key: 'url', label: 'URL', enc: urlEncode, dec: urlDecode },
  { key: 'json', label: 'JSON 转义', enc: jsonEscape, dec: jsonUnescape },
  { key: 'unicode', label: 'Unicode', enc: unicodeEscape, dec: unicodeUnescape }
];

function CodecTool() {
  const [codec, setCodec] = useState('base64');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');

  const run = (mode) => {
    const c = CODECS.find((x) => x.key === codec);
    try {
      setOutput(mode === 'enc' ? c.enc(input) : c.dec(input));
      setError('');
    } catch (e) {
      setError(e.message || '转换失败');
      setOutput('');
    }
  };

  return (
    <div className="tool-section">
      <div className="tool-row">
        <select className="body-type-select" value={codec} onChange={(e) => setCodec(e.target.value)}>
          {CODECS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button className="btn-secondary" onClick={() => run('enc')}>编码 ↓</button>
        <button className="btn-secondary" onClick={() => run('dec')}>解码 ↓</button>
        <button className="btn-secondary" onClick={() => { setInput(output); setOutput(''); }} disabled={!output}>
          结果作为输入 ↑
        </button>
      </div>
      <textarea
        className="tool-textarea"
        placeholder="输入文本..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {error && <div className="script-error">{error}</div>}
      <textarea className="tool-textarea" placeholder="输出结果" value={output} readOnly />
      <div className="tool-row">
        <button
          className="btn-secondary"
          disabled={!output}
          onClick={() => navigator.clipboard.writeText(output)}
        >
          复制结果
        </button>
      </div>
    </div>
  );
}

function TimestampTool() {
  const [ts, setTs] = useState(String(Date.now()));
  const [dateStr, setDateStr] = useState(formatDate(new Date()));
  const [tsResult, setTsResult] = useState('');
  const [dateResult, setDateResult] = useState('');
  const [now, setNow] = useState(Date.now());

  return (
    <div className="tool-section">
      <div className="tool-block">
        <div className="tool-block-title">当前时间戳</div>
        <div className="tool-row">
          <code className="tool-code">{now}</code>
          <code className="tool-code">{Math.floor(now / 1000)}（秒）</code>
          <button className="btn-secondary" onClick={() => setNow(Date.now())}>刷新</button>
          <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(String(now))}>复制毫秒</button>
        </div>
      </div>
      <div className="tool-block">
        <div className="tool-block-title">时间戳 → 日期</div>
        <div className="tool-row">
          <input className="url-input tool-input" value={ts} onChange={(e) => setTs(e.target.value)} placeholder="支持秒 / 毫秒" />
          <button
            className="btn-secondary"
            onClick={() => {
              try {
                const r = tsToDate(ts.trim());
                setTsResult(`${r.date}（按${r.unit}解析）`);
              } catch (e) {
                setTsResult(e.message);
              }
            }}
          >
            转换
          </button>
          {tsResult && <code className="tool-code">{tsResult}</code>}
        </div>
      </div>
      <div className="tool-block">
        <div className="tool-block-title">日期 → 时间戳</div>
        <div className="tool-row">
          <input className="url-input tool-input" value={dateStr} onChange={(e) => setDateStr(e.target.value)} placeholder="如 2026-07-29 12:00:00" />
          <button
            className="btn-secondary"
            onClick={() => {
              try {
                const r = dateToTs(dateStr.trim());
                setDateResult(`${r.millis} 毫秒 / ${r.seconds} 秒`);
              } catch (e) {
                setDateResult(e.message);
              }
            }}
          >
            转换
          </button>
          {dateResult && <code className="tool-code">{dateResult}</code>}
        </div>
      </div>
    </div>
  );
}

function UuidTool() {
  const [count, setCount] = useState(5);
  const [upper, setUpper] = useState(false);
  const [noDash, setNoDash] = useState(false);
  const [list, setList] = useState(() => genUuids(5));

  const display = list.map((u) => {
    let s = noDash ? u.replaceAll('-', '') : u;
    return upper ? s.toUpperCase() : s;
  });

  return (
    <div className="tool-section">
      <div className="tool-row">
        <label className="inline-label">数量
          <input
            type="number" min="1" max="100" className="url-input tool-num"
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="inline-label">
          <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> 大写
        </label>
        <label className="inline-label">
          <input type="checkbox" checked={noDash} onChange={(e) => setNoDash(e.target.checked)} /> 无连字符
        </label>
        <button className="btn-primary" onClick={() => setList(genUuids(count))}>生成</button>
        <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(display.join('\n'))}>复制全部</button>
      </div>
      <textarea className="tool-textarea uuid-output" readOnly value={display.join('\n')} />
    </div>
  );
}

function DiffTool() {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [view, setView] = useState('split'); // 'split' | 'unified'
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [fmtJson, setFmtJson] = useState(false);
  const [collapsed, setCollapsed] = useState(true); // 折叠连续相同行
  const leftPaneRef = useRef(null);
  const rightPaneRef = useRef(null);
  const syncingRef = useRef(false);

  // JSON 格式化
  const formatIfJson = useCallback((text) => {
    if (!fmtJson) return text;
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; }
  }, [fmtJson]);

  const leftText = useMemo(() => formatIfJson(left), [left, fmtJson]);
  const rightText = useMemo(() => formatIfJson(right), [right, fmtJson]);

  // 实时对比（debounce）
  const diff = useMemo(() => {
    if (!leftText && !rightText) return null;
    return diffLines(leftText, rightText, { ignoreWhitespace: ignoreWs });
  }, [leftText, rightText, ignoreWs]);

  const stats = useMemo(() => diff ? diffStats(diff) : null, [diff]);
  const sim = useMemo(() => diff ? similarity(diff) : null, [diff]);
  const aligned = useMemo(() => diff ? alignSideBySide(diff) : [], [diff]);

  // 同步滚动
  const handleScroll = (source) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const other = source === 'left' ? rightPaneRef.current : leftPaneRef.current;
    const src = source === 'left' ? leftPaneRef.current : rightPaneRef.current;
    if (other && src) { other.scrollTop = src.scrollTop; }
    requestAnimationFrame(() => { syncingRef.current = false; });
  };

  // 折叠逻辑：连续 same 行超过 3 行时折叠中间部分
  const buildRows = (rows) => {
    if (!collapsed) return rows.map((r, i) => ({ ...r, _idx: i }));
    const result = [];
    let sameRun = [];
    const flush = () => {
      if (sameRun.length <= 6) {
        sameRun.forEach((r) => result.push(r));
      } else {
        result.push(sameRun[0], sameRun[1], sameRun[2]);
        result.push({ _fold: true, count: sameRun.length - 6 });
        result.push(sameRun[sameRun.length - 3], sameRun[sameRun.length - 2], sameRun[sameRun.length - 1]);
      }
      sameRun = [];
    };
    for (let i = 0; i < rows.length; i++) {
      const r = { ...rows[i], _idx: i };
      if (r.left && r.left.type === 'same') { sameRun.push(r); }
      else { if (sameRun.length) flush(); result.push(r); }
    }
    if (sameRun.length) flush();
    return result;
  };

  const displayRows = useMemo(() => buildRows(aligned), [aligned, collapsed]);

  /** 渲染字符级高亮 */
  const renderChars = (chars, side) => {
    if (!chars) return null;
    return chars.map((c, i) => {
      if (c.type === 'same') return <span key={i}>{c.text}</span>;
      if (side === 'left' && c.type === 'del') return <span key={i} className="diff-char-del">{c.text}</span>;
      if (side === 'right' && c.type === 'add') return <span key={i} className="diff-char-add">{c.text}</span>;
      return null;
    });
  };

  return (
    <div className="tool-section diff-tool">
      {/* 工具栏 */}
      <div className="diff-toolbar">
        <div className="diff-toolbar-left">
          <button className={`seg-btn ${view === 'split' ? 'active' : ''}`} onClick={() => setView('split')}>分栏视图</button>
          <button className={`seg-btn ${view === 'unified' ? 'active' : ''}`} onClick={() => setView('unified')}>统一视图</button>
        </div>
        <div className="diff-toolbar-right">
          <label className="inline-label"><input type="checkbox" checked={ignoreWs} onChange={(e) => setIgnoreWs(e.target.checked)} />忽略空白</label>
          <label className="inline-label"><input type="checkbox" checked={fmtJson} onChange={(e) => setFmtJson(e.target.checked)} />格式化 JSON</label>
          <label className="inline-label"><input type="checkbox" checked={collapsed} onChange={(e) => setCollapsed(e.target.checked)} />折叠相同行</label>
          <button className="btn-secondary" title="交换左右" onClick={() => { const t = left; setLeft(right); setRight(t); }}>⇄ 交换</button>
          <button className="btn-secondary" onClick={() => { setLeft(''); setRight(''); }}>清除</button>
        </div>
      </div>

      {/* 输入区 */}
      <div className="diff-inputs">
        <textarea
          className="tool-textarea"
          placeholder="原始文本（左）"
          value={left}
          onChange={(e) => setLeft(e.target.value)}
          spellCheck={false}
        />
        <textarea
          className="tool-textarea"
          placeholder="对比文本（右）"
          value={right}
          onChange={(e) => setRight(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* 统计栏 */}
      {stats && (diff && diff.length > 0) && (
        <div className="diff-stats-bar">
          <span className="diff-stat-add">+{stats.added}</span>
          <span className="diff-stat-del">−{stats.removed}</span>
          <span className="diff-stat-mod">~{Math.min(stats.added, stats.removed)} 修改</span>
          <span className="diff-stat-sim">相似度: {sim}%</span>
          {stats.added === 0 && stats.removed === 0 && <span className="diff-stat-ok">✓ 完全一致</span>}
        </div>
      )}

      {/* 分栏视图 */}
      {diff && view === 'split' && (
        <div className="diff-split">
          <div className="diff-pane diff-pane-left" ref={leftPaneRef} onScroll={() => handleScroll('left')}>
            {displayRows.map((row, i) => row._fold ? (
              <div key={`fold-${i}`} className="diff-fold-line" onClick={() => setCollapsed(false)}>⋯ {row.count} 行相同</div>
            ) : (
              <div key={i} className={`diff-row diff-row-${row.left.type}`}>
                <span className="diff-linenum">{row.left.lineNo ?? ''}</span>
                <span className="diff-text">
                  {row.left.chars ? renderChars(row.left.chars, 'left') : (row.left.text || '\u00A0')}
                </span>
              </div>
            ))}
          </div>
          <div className="diff-pane diff-pane-right" ref={rightPaneRef} onScroll={() => handleScroll('right')}>
            {displayRows.map((row, i) => row._fold ? (
              <div key={`fold-${i}`} className="diff-fold-line" onClick={() => setCollapsed(false)}>⋯ {row.count} 行相同</div>
            ) : (
              <div key={i} className={`diff-row diff-row-${row.right.type}`}>
                <span className="diff-linenum">{row.right.lineNo ?? ''}</span>
                <span className="diff-text">
                  {row.right.chars ? renderChars(row.right.chars, 'right') : (row.right.text || '\u00A0')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 统一视图 */}
      {diff && view === 'unified' && (
        <div className="diff-unified">
          {diff.length === 0 || diff.every((l) => l.type === 'same') ? (
            <div className="empty-hint">两段文本完全一致</div>
          ) : diff.map((l, i) => (
            <div key={i} className={`diff-line diff-line-${l.type}`}>
              <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
              <span className="diff-text">{l.text || '\u00A0'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 单个工具面板：作为主区标签页内容渲染 */
export default function ToolsPanel({ tool }) {
  const meta = TOOLS.find((t) => t.key === tool) || TOOLS[0];
  return (
    <div className="tools-panel">
      <div className="page-header">
        <span className="page-header-icon"><JbIcon name={meta.icon} size={16} /></span>
        <span className="page-header-title">{meta.label}</span>
        <span className="page-header-desc">{meta.desc}</span>
      </div>
      <div className="tools-body">
        {meta.key === 'codec' && <CodecTool />}
        {meta.key === 'timestamp' && <TimestampTool />}
        {meta.key === 'uuid' && <UuidTool />}
        {meta.key === 'diff' && <DiffTool />}
      </div>
    </div>
  );
}
