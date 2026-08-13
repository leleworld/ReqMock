import React, { useState, useMemo } from 'react';
import {
  b64Encode, b64Decode, urlEncode, urlDecode,
  jsonEscape, jsonUnescape, unicodeEscape, unicodeUnescape,
  tsToDate, dateToTs, formatDate, genUuids
} from '../utils/toolboxUtil.js';
import { diffLines, diffStats } from '../utils/diffUtil.js';
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
  const [result, setResult] = useState(null);

  const stats = useMemo(() => (result ? diffStats(result) : null), [result]);

  return (
    <div className="tool-section diff-tool">
      <div className="diff-inputs">
        <textarea
          className="tool-textarea"
          placeholder="原始文本（左）"
          value={left}
          onChange={(e) => setLeft(e.target.value)}
        />
        <textarea
          className="tool-textarea"
          placeholder="对比文本（右）"
          value={right}
          onChange={(e) => setRight(e.target.value)}
        />
      </div>
      <div className="tool-row">
        <button className="btn-primary" onClick={() => setResult(diffLines(left, right))}>对比</button>
        {stats && (
          <span className="diff-stats">
            <span className="diff-stat-add">+{stats.added}</span>
            <span className="diff-stat-del">-{stats.removed}</span>
          </span>
        )}
        {result && <button className="btn-secondary" onClick={() => setResult(null)}>清除结果</button>}
      </div>
      {result && (
        <div className="diff-result">
          {result.length === 0 || result.every((l) => l.type === 'same') ? (
            <div className="empty-hint">两段文本完全一致</div>
          ) : (
            result.map((l, i) => (
              <div key={i} className={`diff-line diff-${l.type}`}>
                <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
                {l.text || '\u00A0'}
              </div>
            ))
          )}
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
