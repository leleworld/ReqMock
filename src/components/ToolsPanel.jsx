import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  b64Encode, b64Decode, urlEncode, urlDecode,
  jsonEscape, jsonUnescape, unicodeEscape, unicodeUnescape,
  tsToDate, dateToTs, formatDate, genUuids
} from '../utils/toolboxUtil.js';
import { diffLines, diffStats, similarity, alignSideBySide } from '../utils/diffUtil.js';
import { diffRequests, describeChange, changeLabel, shortenValue } from '../utils/requestDelta.js';
import { diffJson, parseSnapJson, fmtDiffValue } from '../utils/responseDiff.js';
import AiPanel from './AiPanel.jsx';
import { JbIcon } from './Icons.jsx';

/** 工具清单：侧栏工具箱展示，每个工具在主区以独立标签页打开 */
export const TOOLS = [
  { key: 'metrics', label: '请求总览', icon: 'activity', desc: '全部请求埋点的统计与 AI 分析' },
  { key: 'analysis', label: '接口总览', icon: 'compare', desc: '按接口聚合：时间轴、参数变动、响应差异与 AI 分析' }
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

/** 流量报告：聚合 GUI / Runner / skill 的埋点记录，生成 HTML 报告并内嵌在本页 iframe 展示（不跳外部浏览器） */
function MetricsTool() {
  const [busy, setBusy] = useState(false);
  const [html, setHtml] = useState('');
  const [meta, setMeta] = useState('');
  const [err, setErr] = useState('');
  const load = async () => {
    setBusy(true); setErr('');
    try {
      const r = await window.api.openMetricsReport();
      if (r.ok) { setHtml(r.html); setMeta(`共 ${r.total} 条记录`); }
      else setErr(r.error || '生成失败');
    } catch (e) {
      setErr('生成失败: ' + (e.message || e));
    } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="metrics-tool">
      <div className="tool-row">
        <button className="btn-secondary" onClick={load} disabled={busy}>{busy ? '生成中…' : '刷新报告'}</button>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{meta} · 汇总 GUI 单发 / Runner 批量 / 千问办公 skill 调用的全部埋点，旧历史记录并入统计</span>
      </div>
      <AiPanel kind="report" />
      {err ? <div className="empty-hint">{err}</div>
        : html
          ? <iframe className="metrics-frame" title="流量报告" srcDoc={html} />
          : <div className="empty-hint">{busy ? '生成中…' : '暂无报告'}</div>}
    </div>
  );
}

/** 参数级 diff（两组 [{k,v}] → 变动列表），与 analyze 输出的 run.params 同构 */
function paramChanges(pa, pb) {
  const A = {}, B = {};
  (pa || []).forEach((x) => { A[x.k] = x.v; });
  (pb || []).forEach((x) => { B[x.k] = x.v; });
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  const out = [];
  for (const k of keys) {
    if (!(k in A)) out.push({ t: 'add', k, to: B[k] });
    else if (!(k in B)) out.push({ t: 'del', k, from: A[k] });
    else if (String(A[k]) !== String(B[k])) out.push({ t: 'mod', k, from: A[k], to: B[k] });
  }
  return out;
}

/** 接口分析：调用主进程 metrics:analyze（与 HTML 报告同一 analyze() 引擎），
 *  提供 结论(自动异常) + 多维筛选(时间/来源/域名) + 接口榜 + 钻取(时间轴/参数变动/响应diff)。 */
function AnalysisTool() {
  const [filter, setFilter] = useState({ days: 0, src: 'all', host: 'all' });
  const [data, setData] = useState(null);
  const [drill, setDrill] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.api.analyzeMetrics(filter).then((d) => { if (alive) { setData(d); setLoading(false); } });
    return () => { alive = false; };
  }, [filter]);

  const fmtT = (t) => {
    const d = new Date(t);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  };

  if (!data) return <div className="empty-hint">{loading ? '分析中…' : '加载中…'}</div>;
  const { summary, insights, endpoints, heat } = data;
  const srcs = ['all', ...Object.keys(summary.bySrc || {})];
  const hosts = ['all', ...heat.map((h) => h.host)];
  const drillEp = drill ? endpoints.find((e) => e.key === drill) : null;

  // 钻取：接口时间轴 + 相邻参数变动 + 最近两次响应 diff
  let drillBody = null;
  if (drillEp) {
    const runs = drillEp.runs || [];
    let ja = null, jb = null;
    if (runs.length >= 2) { try { ja = JSON.parse(runs[1].respBody); } catch {} try { jb = JSON.parse(runs[0].respBody); } catch {} }
    const ds = (ja && jb) ? diffJson(ja, jb) : null;
    drillBody = (
      <div className="tool-section" style={{ gap: 8 }}>
        <div className="tool-section-head" style={{ color: 'var(--text-dim)', fontSize: 12 }}>{drillEp.key} · 发送时间轴（{runs.length} 次，新→旧）</div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {runs.map((r, i) => {
            const prev = runs[i + 1] || null;
            const ch = prev ? paramChanges(prev.params, r.params) : [];
            const bad = !r.ok;
            return (
              <div key={r.ts + '-' + i} className="editor-history-row" style={{ padding: '3px 6px', marginBottom: 3 }}>
                <div className="editor-history-main" style={{ flexWrap: 'wrap', rowGap: 2 }}>
                  <span className="editor-history-idx">{runs.length - i}</span>
                  <span className="editor-history-time">{fmtT(r.ts)}</span>
                  <span className={`status-tag ${bad ? 'status-bad' : 'status-good'}`}>{r.status || 'ERR'}</span>
                  <span className="editor-history-ms">{r.timeMs}ms</span>
                  <span className="chip-src">{r.src}</span>
                  {r.err && <span className="eh-to" style={{ color: 'var(--red)' }}>{r.err}</span>}
                  <span className="editor-history-delta">
                    {!prev && <span className="editor-history-origin">最早记录</span>}
                    {prev && ch.length === 0 && <span className="editor-history-none">无参数改动</span>}
                    {prev && ch.slice(0, 4).map((c) => (
                      <span key={c.k} className="editor-history-change">
                        <span className="eh-k">{c.k}</span>{' '}
                        {c.t === 'mod' ? <><span className="eh-from">{fmtDiffValue(c.from, 20)}</span><span className="editor-history-arrow">→</span><span className="eh-to">{fmtDiffValue(c.to, 20)}</span></>
                          : c.t === 'add' ? <span className="eh-to">+{fmtDiffValue(c.to, 20)}</span>
                          : <span className="eh-from">-{fmtDiffValue(c.from, 20)}</span>}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="tool-section-head" style={{ color: 'var(--text-dim)', fontSize: 12 }}>最近两次响应差异</div>
        {ds === null ? <div className="empty-hint">快照不足（需 2 次 JSON 响应）</div>
          : ds.length === 0 ? <div className="eh-stats"><span className="eh-stat eh-stat-good">✓ 响应完全一致（已滤 signatureServer/traceSign）</span></div>
          : (
            <div className="editor-history-changes" style={{ maxHeight: 300, overflowY: 'auto' }}>
              {ds.slice(0, 50).map(([p, va, vb]) => (
                <React.Fragment key={p}>
                  <div className="eh-line del"><span className="eh-sign">−</span><span className="eh-name">{p}</span><span>{fmtDiffValue(va)}</span></div>
                  <div className="eh-line add"><span className="eh-sign">+</span><span className="eh-name">{p}</span><span>{fmtDiffValue(vb)}</span></div>
                </React.Fragment>
              ))}
              {ds.length > 50 && <div className="eh-line"><span className="eh-sign">…</span><span className="eh-name">其余 {ds.length - 50} 处略</span></div>}
            </div>
          )}
        <AiPanel kind="endpoint" endpointKey={drillEp.key} filter={filter} />
      </div>
    );
  }

  return (
    <div className="tool-section" style={{ gap: 12 }}>
      {/* 多维筛选 */}
      <div className="tool-row">
        <span className="fl" style={{ color: 'var(--text-dim)', fontSize: 12 }}>时间</span>
        <span className="seg-mini">
          {[[0, '全部'], [1, '近1天'], [7, '近7天'], [30, '近30天']].map(([d, l]) => (
            <button key={d} className={filter.days === d ? 'on' : ''} onClick={() => setFilter((f) => ({ ...f, days: d }))}>{l}</button>
          ))}
        </span>
        <span className="fl" style={{ color: 'var(--text-dim)', fontSize: 12, marginLeft: 8 }}>来源</span>
        <select className="body-type-select" value={filter.src} onChange={(e) => setFilter((f) => ({ ...f, src: e.target.value }))}>
          {srcs.map((s) => <option key={s} value={s}>{s === 'all' ? '全部' : s}</option>)}
        </select>
        <span className="fl" style={{ color: 'var(--text-dim)', fontSize: 12, marginLeft: 8 }}>域名</span>
        <select className="body-type-select" value={filter.host} onChange={(e) => setFilter((f) => ({ ...f, host: e.target.value }))}>
          {hosts.map((h) => <option key={h} value={h}>{h === 'all' ? '全部' : h}</option>)}
        </select>
        {loading && <span className="dim" style={{ fontSize: 11 }}>分析中…</span>}
      </div>

      {/* 概览 */}
      <div className="eh-stats">
        <span className="eh-stat">请求 {summary.total}</span>
        <span className={`eh-stat ${summary.fail ? 'eh-stat-bad' : 'eh-stat-good'}`}>成功 {summary.ok} / 失败 {summary.fail}</span>
        <span className="eh-stat">平均 {summary.avg}ms</span>
        <span className="eh-stat">P95 {summary.p95}ms</span>
        <span className="eh-stat">接口 {summary.endpoints} 个</span>
      </div>

      {/* 自动结论 */}
      <div className="tool-section-head" style={{ color: 'var(--text-dim)', fontSize: 12 }}>自动结论（{insights.length}）</div>
      {insights.length === 0 ? <div className="eh-stats"><span className="eh-stat eh-stat-good">✓ 未发现明显异常，整体平稳</span></div> : (
        <div className="tool-section" style={{ gap: 6 }}>
          {insights.map((it, i) => (
            <div key={i} className={`insight-card insight-${it.sev}`}>
              <span className="insight-ic">{it.icon}</span>
              <div style={{ flex: 1 }}>
                <span className="insight-tt">{it.title}</span>
                <span className="insight-dt"> · {it.detail}</span>
              </div>
              {it.key && <button className="btn-secondary" onClick={() => setDrill(it.key)}>查看证据</button>}
            </div>
          ))}
        </div>
      )}

      {/* 全局 AI 分析 */}
      <AiPanel kind="endpoints" filter={filter} />

      {/* 接口榜（点行钻取） */}
      <div className="tool-section-head" style={{ color: 'var(--text-dim)', fontSize: 12 }}>接口（点行钻取时间轴 / 参数变动 / 响应差异）</div>
      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table className="analysis-table">
          <thead><tr><th>接口</th><th>次数</th><th>失败</th><th>失败率</th><th>平均</th><th>P95</th></tr></thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.key} className={drill === e.key ? 'sel' : ''} onClick={() => setDrill(e.key)}>
                <td className="mono">{e.key}</td>
                <td className="mono">{e.count}</td>
                <td className={`mono ${e.fail ? 'bad' : ''}`}>{e.fail}</td>
                <td className={`mono ${e.failRate > 0.3 ? 'bad' : ''}`}>{Math.round(e.failRate * 100)}%</td>
                <td className="mono">{e.avg}ms</td>
                <td className="mono">{e.p95}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drillBody}
    </div>
  );
}

/** 单个工具面板：作为主区标签页内容渲染 */
export default function ToolsPanel({ tool, history, collections, workMode }) {
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
        {meta.key === 'metrics' && <MetricsTool />}
        {meta.key === 'analysis' && <AnalysisTool history={history} collections={collections} workMode={workMode} />}
      </div>
    </div>
  );
}
