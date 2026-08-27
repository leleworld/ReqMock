import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { tokenizeJson, HIGHLIGHT_MAX_LENGTH } from '../utils/highlightUtil.js';
import JsonFormatWorker from '../utils/jsonFormatWorker.js?worker';
import { tryDecodeSelection } from '../utils/toolboxUtil.js';
import { explainRequestError } from '../utils/errorExplain.js';
import { diffLines, diffStats } from '../utils/diffUtil.js';
import { toCurl } from '../utils/curlUtil.js';
import CodeEditor from './CodeEditor.jsx';
import { JbIcon } from './Icons.jsx';

/** 体内搜索最大命中数 */
const SEARCH_MAX_HITS = 5000;
/** Hex 视图最大显示字节数 */
const HEX_MAX_BYTES = 512 * 1024;
/** 响应体大文件阈值（1MB） */
const LARGE_BODY_THRESHOLD = 1024 * 1024;
/** 大文件最大显示行数 */
const LARGE_BODY_MAX_LINES = 5000;
/** 页签/视图顺序：切换时据序号差决定滑动方向 */
const RESP_TABS = ['body', 'headers', 'cookies', 'timings', 'trace', 'tests'];
const RESP_VIEWS = ['pretty', 'raw', 'tree', 'hex', 'preview', 'diff'];

/** 重内容延迟一帧挂载：先出骨架占位，待入场动画起步后再挂 CodeMirror 等大组件，避免同帧卡顿 */
function DeferredMount({ children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) return <div className="pane-skeleton" aria-hidden="true"><i /><i /><i /></div>;
  return children;
}

/**
 * 发送实时计时器：sending=true 时每 100ms 递增显示
 */
function SendingTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => {
      setElapsed(Math.round((performance.now() - start) / 100) / 10);
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="sending-timer">
      <span className="sending-timer-dot" />
      <span className="sending-timer-text">
        发送中... {elapsed.toFixed(1)}s
      </span>
    </div>
  );
}

/**
 * 响应面板：状态行 + Body(Pretty/Raw/Tree/Hex + 搜索/下载)/Headers/测试 页签 + 响应历史回看 + 布局切换 + 响应转 Mock 按钮
 * 失败时展示诊断视图：错误解释 + 排查建议 + 实际发送的请求 + 重试/复制 cURL 等快捷动作
 */
export default function ResponsePanel({
  response, sending, scriptResult, onResponseToMock, onToast,
  layout, onToggleLayout, focused, onToggleFocus, historyList = [], onSelectHistory,
  onRetry, onRetryNoSsl, onOpenConsole,
  onSaveExample, onSaveBody, onExtractVariable, onInsertAssertion,
  fontSize, tabSize, wordWrap, showLineNumbers
}) {
  const [tab, setTab] = useState('body');
  const [view, setView] = useState('pretty');
  const [histOpen, setHistOpen] = useState(false); // 响应历史下拉
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSense, setCaseSense] = useState(false);
  const [regexOn, setRegexOn] = useState(false);
  const [hitIdx, setHitIdx] = useState(0);
  const [wrapOn, setWrapOn] = useState(true); // 正文自动换行开关
  const [decodeTip, setDecodeTip] = useState(null); // { kind, text, x, y }
  const contentRef = useRef(null);
  const searchInputRef = useRef(null);
  const paneKey = `${tab}-${view}`;
  const prevPaneKeyRef = useRef(paneKey);
  const paneDirRef = useRef(1);
  if (prevPaneKeyRef.current !== paneKey) {
    const rank = (t, v) => RESP_TABS.indexOf(t) * 10 + RESP_VIEWS.indexOf(v);
    const [pt, pv] = prevPaneKeyRef.current.split('-');
    paneDirRef.current = rank(tab, view) >= rank(pt, pv) ? 1 : -1;
    prevPaneKeyRef.current = paneKey;
  }

  // ── Web Worker 格式化：JSON parse + stringify 完全在独立线程执行，主线程零阻塞 ──
  const [fmtResult, setFmtResult] = useState(null); // { pretty, isJson }
  const workerRef = useRef(null);
  const fmtIdRef = useRef(0);

  // 创建 / 销毁 Worker（组件级单例）
  useEffect(() => {
    const w = new JsonFormatWorker();
    w.onmessage = (e) => {
      const { id, ok, pretty } = e.data;
      if (id === fmtIdRef.current) {
        setFmtResult(ok ? { pretty, isJson: true } : { pretty: '', isJson: false });
      }
    };
    workerRef.current = w;
    return () => { w.terminate(); workerRef.current = null; };
  }, []);

  // 响应变化时触发格式化（小响应同步，大响应走 Worker）
  useEffect(() => {
    if (!response || !response.ok) { setFmtResult(null); setTreeData(null); return; }
    setTreeData(null); // 重置 Tree 缓存
    const body = response.body;
    const id = ++fmtIdRef.current;
    // ≤500KB 同步处理（实测 <30ms）：避免 Worker 异步返回前 fmtResult=null 导致搜索视图瞬间显示未格式化原文
    if (body.length <= 500000) {
      try {
        const pretty = JSON.stringify(JSON.parse(body), null, 2);
        setFmtResult({ pretty, isJson: true });
      } catch (_e) {
        setFmtResult({ pretty: '', isJson: false });
      }
      return;
    }
    // 超大响应（>500KB）：先展示原始 body，Worker 后台格式化完成后自动替换
    setFmtResult(null);
    workerRef.current.postMessage({ id, body });
  }, [response]);

  // Pretty 视图文本 + 高亮 token（小响应同步 tokenize，大响应跳过 token 走 CodeMirror 内置高亮）
  const { prettyBody, tokens, fmtPending } = useMemo(() => {
    if (!response || !response.ok) return { prettyBody: '', tokens: null, fmtPending: false };
    // fmtResult 尚未就绪（Worker 处理中）时标记 pending，搜索视图回退 CodeMirror 避免显示原始单行 JSON
    const pending = !fmtResult && response.body.length > 500000;
    const body = fmtResult ? fmtResult.pretty : response.body;
    if (body.length <= HIGHLIGHT_MAX_LENGTH && fmtResult && fmtResult.isJson) {
      return { prettyBody: body, tokens: tokenizeJson(body), fmtPending: false };
    }
    return { prettyBody: body, tokens: null, fmtPending: pending };
  }, [response, fmtResult]);

  // Tree 视图解析：按需懒解析（仅在用户切到 Tree 视图时执行，不再重复 parse）
  const [treeData, setTreeData] = useState(null);
  const parsedJson = useMemo(() => {
    if (!response || !response.ok) return { ok: false };
    if (treeData !== null) return { ok: true, data: treeData };
    if (fmtResult && !fmtResult.isJson) return { ok: false };
    if (fmtResult && fmtResult.isJson) return { ok: true }; // Worker 已验证合法 JSON
    try { JSON.parse(response.body); return { ok: true }; } catch { return { ok: false }; }
  }, [response, fmtResult, treeData]);

  // Tree 视图懒解析：切到 Tree 时才解析完整 JSON 并缓存
  useEffect(() => {
    if (view !== 'tree' || !response || !response.ok || treeData !== null) return;
    try { setTreeData(JSON.parse(response.body)); } catch (_e) { /* 非 JSON */ }
  }, [view, response, treeData]);

  // 体内搜索：把当前视图文本切成 普通段/命中段，命中段带序号；同时记录命中区间供高亮合并渲染
  const searchInfo = useMemo(() => {
    if (!searchOpen || !query || !response || !response.ok) return null;
    const text = view === 'raw' ? response.body : prettyBody;
    let re;
    try {
      const src = regexOn ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(src, caseSense ? 'g' : 'gi');
    } catch (e) {
      return { error: true, segments: null, hits: null, count: 0 };
    }
    const segments = [];
    const hits = [];
    let count = 0;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > last) segments.push({ t: text.slice(last, m.index) });
      hits.push({ start: m.index, end: m.index + m[0].length, idx: count });
      segments.push({ t: m[0], hit: count++ });
      last = m.index + m[0].length;
      if (count >= SEARCH_MAX_HITS) break;
    }
    if (last < text.length) segments.push({ t: text.slice(last) });
    return { error: false, segments, hits, count };
  }, [searchOpen, query, caseSense, regexOn, view, prettyBody, response]);

  const hitCount = searchInfo && !searchInfo.error ? searchInfo.count : 0;
  const curHit = hitCount > 0 ? ((hitIdx % hitCount) + hitCount) % hitCount : 0;

  // 搜索条件变化时回到第一个命中
  useEffect(() => { setHitIdx(0); }, [query, caseSense, regexOn, view]);

  // Pretty 视图：将搜索查询传递给 CodeMirror 装饰系统
  const cmSearchQuery = useMemo(() => {
    if (!searchOpen || view !== 'pretty' || !query) return null;
    try {
      const src = regexOn ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { query: new RegExp(src, caseSense ? 'g' : 'gi'), activeIdx: hitCount > 0 ? curHit : -1 };
    } catch (_e) { return null; }
  }, [searchOpen, view, query, caseSense, regexOn, curHit, hitCount]);

  // 当前命中滚动到可视区域中央（非 Pretty 视图用 DOM scrollIntoView）
  useEffect(() => {
    if (view === 'pretty' || !contentRef.current) return;
    const el = contentRef.current.querySelector('.search-hit-active');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [curHit, searchInfo, view]);

  // 打开搜索栏时聚焦输入框
  useEffect(() => {
    if (searchOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [searchOpen]);

  // Ctrl/Cmd+F：打开响应体搜索栏并聚焦（输入框/可编辑编辑器内保留其自身的查找行为）
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'f') return;
      if (!response || !response.ok) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      setTab('body');
      if (searchOpen && searchInputRef.current) {
        searchInputRef.current.focus();
        searchInputRef.current.select();
      } else {
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [response, searchOpen]);

  // 历史下拉展开后：点击弹层外部或按 Esc 自动关闭
  useEffect(() => {
    if (!histOpen) return;
    const onMouseDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.resp-history-anchor')) return;
      setHistOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setHistOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [histOpen]);

  // 布局切换按钮：四种面板状态（空/发送中/成功/失败）均可达
  const layoutBtn = onToggleLayout ? (
    <button
      className="icon-btn"
      title={layout === 'vertical' ? '切换为左右分栏' : '切换为上下分栏'}
      onClick={onToggleLayout}
    >{layout === 'vertical' ? '◫' : '⊟'}</button>
  ) : null;

  // 专注模式按钮：临时隐藏请求编辑区，响应独占全屏（Esc 退出）
  const focusBtn = onToggleFocus ? (
    <button
      className={focused ? 'icon-btn on' : 'icon-btn'}
      title={focused ? '退出专注模式 (Esc)' : '专注响应：隐藏请求编辑区'}
      onClick={onToggleFocus}
    >{focused ? '⤢' : '⤡'}</button>
  ) : null;

  const cornerActions = <>{focusBtn}{layoutBtn}</>;

  // 响应历史回看：同一标签多次发送的响应可回看对比（会话级）
  const historyBtn = historyList.length > 1 ? (
    <span className="resp-history-anchor">
      <button
        className={histOpen ? 'icon-btn on' : 'icon-btn'}
        title="回看本标签最近的响应"
        onClick={() => setHistOpen(!histOpen)}
      >⏱ {historyList.length}</button>
      {histOpen && (
        <div className="ctx-menu resp-history-menu">
          {historyList.map((h) => (
            <div
              key={h.id}
              className="ctx-item"
              onClick={() => { setHistOpen(false); onSelectHistory && onSelectHistory(h); }}
            >
              <span className="ctx-check">{response === h.response ? <JbIcon name="checkmark" size={12} /> : ''}</span>
              {h.response.ok ? (
                <span className={`status-tag ${h.response.status < 400 ? 'status-good' : 'status-bad'}`}>{h.response.status}</span>
              ) : (
                <span className="status-tag status-bad">失败</span>
              )}
              <span className="ctx-label">{h.time}</span>
              {h.response.timeMs != null && <span className="ctx-kbd">{h.response.timeMs} ms</span>}
            </div>
          ))}
        </div>
      )}
    </span>
  ) : null;

  if (sending) {
    return (
      <div className="response-panel">
        <div className="response-corner">{cornerActions}</div>
        <SendingTimer />
        <div className="response-placeholder" aria-busy="true">
          <div className="resp-skeleton">
            <div className="skel-line w60" />
            <div className="skel-line w90" style={{marginLeft: 16}} />
            <div className="skel-line w75" style={{marginLeft: 16}} />
            <div className="skel-line w40" style={{marginLeft: 32}} />
            <div className="skel-line w85" style={{marginLeft: 32}} />
            <div className="skel-line w55" style={{marginLeft: 16}} />
            <div className="skel-line w30" />
          </div>
        </div>
      </div>
    );
  }
  if (!response) {
    return (
      <div className="response-panel">
        <div className="response-corner">{cornerActions}</div>
        <div className="response-placeholder">
          <div className="empty-hero">
            <span className="empty-hero-icon" aria-hidden="true"><JbIcon name="play" size={22} /></span>
            <div className="empty-hero-title">发送请求查看响应</div>
            <div className="empty-hero-subtitle">编辑左侧请求参数后点击发送，响应结果将在此展示</div>
            <div className="empty-hero-keys">
              <span className="kbd-chip"><JbIcon name="play" size={11} /> Shift + F10</span> 发送请求
              <span className="kbd-chip">Ctrl + Enter</span> 发送
              <span className="kbd-chip">Ctrl + F</span> 体内搜索
            </div>
            {historyList.length > 0 && (
              <div className="empty-hero-history">
                <div className="empty-hero-history-title"><JbIcon name="time" size={12} /> 最近请求</div>
                <div className="empty-hero-history-list">
                  {historyList.slice(0, 3).map((h) => (
                    <button
                      key={h.id}
                      className="empty-hero-history-item"
                      onClick={() => onSelectHistory && onSelectHistory(h)}
                    >
                      {h.response.ok ? (
                        <span className={`status-tag ${h.response.status < 400 ? 'status-good' : 'status-bad'}`}>{h.response.status}</span>
                      ) : (
                        <span className="status-tag status-bad">失败</span>
                      )}
                      <span className="empty-hero-history-time">{h.time}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
    );
  }
  if (!response.ok) {
    return (
      <FailureView
        response={response}
        scriptResult={scriptResult}
        historyBtn={historyBtn}
        layoutBtn={cornerActions}
        onRetry={onRetry}
        onRetryNoSsl={onRetryNoSsl}
        onOpenConsole={onOpenConsole}
        onToast={onToast}
      />
    );
  }

  const statusClass = response.status < 400 ? 'status-good' : 'status-bad';
  const testCount = scriptResult ? scriptResult.tests.length : 0;
  const testFailed = scriptResult ? scriptResult.tests.filter((t) => !t.passed).length : 0;
  const hasScriptInfo = scriptResult && (testCount > 0 || scriptResult.logs.length > 0 || scriptResult.errors.length > 0);
  const trace = response.trace || [];
  const setCookies = response.setCookies || [];

  /** 下载响应体：优先走 App 层保存通道（支持二进制 bodyBase64），否则按文本导出 */
  const handleDownload = async () => {
    if (onSaveBody) { onSaveBody(); return; }
    const ctEntry = Object.entries(response.headers).find(([k]) => k.toLowerCase() === 'content-type');
    const ext = contentTypeToExt(ctEntry ? ctEntry[1] : '');
    const res = await window.api.exportFile({
      defaultName: `response-${Date.now()}.${ext}`,
      content: response.body
    });
    if (res && res.ok) onToast && onToast('已保存：' + res.filePath);
    else if (res && res.error) onToast && onToast('保存失败：' + res.error);
  };

  /** 复制当前视图的响应体（Pretty 复制美化后文本，其他复制原文） */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(view === 'pretty' ? prettyBody : response.body);
      onToast && onToast('已复制响应体');
    } catch (e) {
      onToast && onToast('复制失败：' + e.message);
    }
  };

  /** 选中文本尝试 JWT / Base64 即时解码，浮层跟随鼠标 */
  const handleMouseUp = (e) => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length > 4096) { setDecodeTip(null); return; }
    const d = tryDecodeSelection(text);
    if (d) {
      setDecodeTip({
        ...d,
        x: Math.min(e.clientX + 8, window.innerWidth - 380),
        y: Math.min(e.clientY + 12, window.innerHeight - 200)
      });
    } else {
      setDecodeTip(null);
    }
  };

  /** 带搜索命中标记的正文渲染（Pretty 视图下命中区间与语法 token 合并，保留 JSON 高亮） */
  const searchActive = !!(searchInfo && !searchInfo.error && query);
  const renderTokenPiece = (tk, text, key) =>
    tk.type === 'plain' ? text : <span key={key} className={`tok-${tk.type}`}>{text}</span>;
  /** token 流按命中区间切片：命中片段包 mark 且叠加原 tok-* 颜色类 */
  const renderTokensWithHits = () => {
    const hits = searchInfo.hits;
    const out = [];
    let pos = 0;
    let hi = 0;
    let key = 0;
    for (const tk of tokens) {
      const end = pos + tk.text.length;
      let cur = pos;
      while (hi < hits.length && hits[hi].start < end) {
        const h = hits[hi];
        const s = Math.max(h.start, cur);
        const t = Math.min(h.end, end);
        if (s > cur) out.push(renderTokenPiece(tk, tk.text.slice(cur - pos, s - pos), key++));
        out.push(
          <mark
            key={key++}
            className={(h.idx === curHit ? 'search-hit search-hit-active' : 'search-hit') + (tk.type !== 'plain' ? ` tok-${tk.type}` : '')}
          >{tk.text.slice(s - pos, t - pos)}</mark>
        );
        cur = t;
        if (h.end <= end) hi++;
        else break;
      }
      if (cur < end) out.push(renderTokenPiece(tk, tk.text.slice(cur - pos), key++));
      pos = end;
    }
    return out;
  };
  const renderBodyText = () => {
    if (searchActive) {
      // Pretty 视图且有语法 token：合并渲染，既保留高亮又精确标记命中
      if (view === 'pretty' && tokens) return renderTokensWithHits();
      return searchInfo.segments.map((seg, i) =>
        seg.hit != null
          ? <mark key={i} className={seg.hit === curHit ? 'search-hit search-hit-active' : 'search-hit'}>{seg.t}</mark>
          : seg.t
      );
    }
    if (view === 'raw') return response.body;
    return tokens
      ? tokens.map((t, i) =>
          t.type === 'plain' ? t.text : <span key={i} className={`tok-${t.type}`}>{t.text}</span>
        )
      : prettyBody;
  };

  // 预览能力判断：图片（需主进程附带 bodyBase64）/ HTML / PDF
  const respCt = (Object.entries(response.headers).find(([k]) => k.toLowerCase() === 'content-type') || [])[1] || '';
  const canPreview = (/^image\//i.test(respCt) && !!response.bodyBase64) || /html/i.test(respCt) || (/pdf/i.test(respCt) && !!response.bodyBase64);
  // Diff 对比基准：本标签历史中除当前外的成功响应
  const diffBases = historyList.filter((h) => h.response !== response && h.response.ok);

  return (
    <div className="response-panel">
      <div className="response-status">
        <span className={`status-tag ${statusClass}`}>{response.status} {response.statusText}</span>
        <span className="meta">HTTP/{response.httpVersion || '1.1'}</span>
        <span className="meta">{response.timeMs} ms</span>
        <span className="meta">{formatSize(response.sizeBytes)}</span>
        {response.fromHistory && <span className="meta" title="此为历史记录中保存的响应快照">📜 历史快照 {response.historyTime || ''}</span>}
        <span className="flex-spacer" />
        {onRetry && <button className="icon-btn" title="重新发送请求 (Shift+F10)" onClick={onRetry}><JbIcon name="update" size={14} /></button>}
        {historyBtn}
        {onSaveExample && <button className="btn-secondary" title="把当前响应保存为请求示例（示例可一键转 Mock）" onClick={onSaveExample}>存为示例</button>}
        <button className="btn-secondary" onClick={onResponseToMock}>响应转 Mock</button>
        {cornerActions}
      </div>

      <LayoutGroup id="resp-tabs">
      <div className="editor-tabs">
        <button className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>
          Body
          {tab === 'body' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        </button>
        <button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}>
          Headers
          <span className="tab-badge">{Object.keys(response.headers).length}</span>
          {tab === 'headers' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        </button>
        {setCookies.length > 0 && (
          <button className={tab === 'cookies' ? 'active' : ''} onClick={() => setTab('cookies')}>
            Cookies
            <span className="tab-badge">{setCookies.length}</span>
            {tab === 'cookies' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        )}
        {response.timings && (
          <button className={tab === 'timings' ? 'active' : ''} onClick={() => setTab('timings')}>
            耗时
            {tab === 'timings' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        )}
        {trace.length > 1 && (
          <button className={tab === 'trace' ? 'active' : ''} onClick={() => setTab('trace')}>
            重定向
            <span className="tab-badge">{trace.length - 1}</span>
            {tab === 'trace' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        )}
        {hasScriptInfo && (
          <button className={tab === 'tests' ? 'active' : ''} onClick={() => setTab('tests')}>
            测试 {testCount > 0 && (testFailed > 0 ? `(${testCount - testFailed}/${testCount} 通过)` : `(${testCount} 通过)`)}
            {tab === 'tests' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        )}
      </div>
      </LayoutGroup>

      {tab === 'body' && (
        <div className="body-toolbar">
          <div className="view-switch">
            {[['pretty', 'Pretty'], ['raw', 'Raw'], ['tree', 'Tree'], ['hex', 'Hex'], ['preview', '预览'], ['diff', 'Diff']].map(([v, label]) => (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                disabled={(v === 'tree' && !parsedJson.ok) || (v === 'preview' && !canPreview) || (v === 'diff' && diffBases.length === 0)}
                title={
                  v === 'tree' && !parsedJson.ok ? '响应不是 JSON'
                    : v === 'preview' && !canPreview ? '仅图片 / HTML / PDF 响应支持预览'
                    : v === 'diff' && diffBases.length === 0 ? '再次发送后可与历史响应对比' : undefined
                }
                onClick={() => setView(v)}
              >{label}</button>
            ))}
          </div>
          <span className="flex-spacer" />
          <button
            className={searchOpen ? 'icon-btn on' : 'icon-btn'}
            title="在响应体中搜索"
            onClick={() => setSearchOpen(!searchOpen)}
          ><JbIcon name="search" size={14} /></button>
          <button
            className={wrapOn ? 'icon-btn on' : 'icon-btn'}
            title={wrapOn ? '关闭自动换行' : '开启自动换行'}
            onClick={() => setWrapOn(!wrapOn)}
          ><JbIcon name="wrap" size={14} /></button>
          <button className="icon-btn" title="复制响应体" onClick={handleCopy}><JbIcon name="copy" size={14} /></button>
          <button className="icon-btn" title="下载响应体为文件" onClick={handleDownload}><JbIcon name="download" size={14} /></button>
        </div>
      )}

      {tab === 'body' && searchOpen && (
        <div className="body-search-bar">
          <input
            ref={searchInputRef}
            className="body-search-input"
            placeholder="搜索响应体…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setHitIdx(e.shiftKey ? hitIdx - 1 : hitIdx + 1);
              if (e.key === 'Escape') { setSearchOpen(false); setQuery(''); }
            }}
          />
          <button
            className={caseSense ? 'search-toggle on' : 'search-toggle'}
            title="区分大小写"
            onClick={() => setCaseSense(!caseSense)}
          >Aa</button>
          <button
            className={regexOn ? 'search-toggle on' : 'search-toggle'}
            title="正则表达式"
            onClick={() => setRegexOn(!regexOn)}
          >.*</button>
          <span className={`search-count ${searchInfo && searchInfo.error ? 'search-count-err' : ''}`}>
            {searchInfo && searchInfo.error
              ? '正则错误'
              : query ? `${hitCount ? curHit + 1 : 0}/${hitCount}` : ''}
          </span>
          <button className="search-toggle" title="上一个 (Shift+Enter)" disabled={!hitCount} onClick={() => setHitIdx(hitIdx - 1)}>↑</button>
          <button className="search-toggle" title="下一个 (Enter)" disabled={!hitCount} onClick={() => setHitIdx(hitIdx + 1)}>↓</button>
          <button className="search-toggle" title="关闭" onClick={() => { setSearchOpen(false); setQuery(''); }}><JbIcon name="close" size={12} /></button>
          {(view === 'tree' || view === 'hex') && <span className="env-hint">搜索仅在 Pretty / Raw 视图生效</span>}
        </div>
      )}

      <div className="response-content" ref={contentRef} onMouseUp={handleMouseUp}>
        {/* 页签/视图切换时方向滑动交叉淡出；滚动容器下沉到 pane 层；重内容延迟一帧挂载 */}
        <div className="response-pane">
        {/* Pretty 视图：始终使用 CodeMirror（内置 Ctrl+F 搜索 + 行号 + 层级折叠），避免自定义 mark 渲染大 JSON 时卡顿 */}
        {tab === 'body' && view === 'pretty' && (
          <DeferredMount>
            {response.body.length > LARGE_BODY_THRESHOLD && (
              <div className="large-body-banner">
                <JbIcon name="warning" size={14} />
                <span>响应体较大（{(response.body.length / 1024 / 1024).toFixed(2)} MB），仅显示前 {LARGE_BODY_MAX_LINES} 行</span>
                <button className="btn-secondary" onClick={handleDownload}><JbIcon name="download" size={12} /> 下载完整响应</button>
              </div>
            )}
            <CodeEditor className="response-code" value={response.body.length > LARGE_BODY_THRESHOLD ? prettyBody.split('\n').slice(0, LARGE_BODY_MAX_LINES).join('\n') : prettyBody} language={parsedJson.ok ? 'json' : 'text'} readOnly lineWrap={wrapOn} searchQuery={cmSearchQuery} fontSize={fontSize} tabSize={tabSize} wordWrap={wordWrap} showLineNumbers={showLineNumbers} />
          </DeferredMount>
        )}
        {tab === 'body' && view === 'raw' && (
          <DeferredMount>
            {response.body.length > LARGE_BODY_THRESHOLD && (
              <div className="large-body-banner">
                <JbIcon name="warning" size={14} />
                <span>响应体较大（{(response.body.length / 1024 / 1024).toFixed(2)} MB），仅显示前 {LARGE_BODY_MAX_LINES} 行</span>
                <button className="btn-secondary" onClick={handleDownload}><JbIcon name="download" size={12} /> 下载完整响应</button>
              </div>
            )}
            <pre className={wrapOn ? 'response-body' : 'response-body nowrap'}>
              {response.body.length > LARGE_BODY_THRESHOLD
                ? response.body.split('\n').slice(0, LARGE_BODY_MAX_LINES).join('\n')
                : renderBodyText()}
            </pre>
          </DeferredMount>
        )}
        {tab === 'body' && view === 'tree' && (
          <DeferredMount>
            {parsedJson.ok
              ? <div className="json-tree"><JsonTree data={parsedJson.data} onExtractVariable={onExtractVariable} onInsertAssertion={onInsertAssertion} onToast={onToast} /></div>
              : <div className="empty-hint" style={{ padding: 12 }}>响应不是合法 JSON，无法以 Tree 视图展示</div>}
          </DeferredMount>
        )}
        {tab === 'body' && view === 'hex' && <DeferredMount><HexView text={response.body} /></DeferredMount>}
        {tab === 'body' && view === 'preview' && <PreviewView response={response} contentType={respCt} />}
        {tab === 'body' && view === 'diff' && <DiffView response={response} bases={diffBases} />}
        {tab === 'headers' && (
          <table className="headers-table">
            <tbody>
              {Object.entries(response.headers).map(([k, v]) => (
                <tr key={k}>
                  <td className="header-key">{k}</td>
                  <td className="header-value">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'cookies' && (
          <table className="headers-table">
            <tbody>
              {setCookies.map((c, i) => (
                <tr key={i}>
                  <td className="header-key">Set-Cookie</td>
                  <td className="header-value">{typeof c === 'string' ? c : c.raw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'timings' && response.timings && <TimingsView timings={response.timings} />}
        {tab === 'trace' && <TraceView trace={trace} />}
        {tab === 'tests' && scriptResult && <ScriptResultView result={scriptResult} />}
        </div>
      </div>

      {decodeTip && (
        <div className="decode-tip" style={{ left: decodeTip.x, top: decodeTip.y }}>
          <div className="decode-tip-title">
            {decodeTip.kind === 'jwt' ? 'JWT 解码' : 'Base64 解码'}
            <span className="decode-tip-close" onClick={() => setDecodeTip(null)}><JbIcon name="close" size={12} /></span>
          </div>
          <pre className="decode-tip-body">{decodeTip.text}</pre>
        </div>
      )}
    </div>
  );
}

/**
 * 失败诊断视图：错误码/失败阶段 + 中文解释 + 原始错误 + 排查建议
 * + 实际发送的请求（变量已替换）+ 重试 / 关 SSL 重试 / 复制 cURL / 控制台入口
 */
function FailureView({ response, scriptResult, historyBtn, layoutBtn, onRetry, onRetryNoSsl, onOpenConsole, onToast }) {
  const explain = useMemo(() => explainRequestError(response), [response]);
  const finalReq = response.finalRequest || null;
  const failUrl = useMemo(() => buildSentUrl(finalReq), [finalReq]);
  const sentHeaders = finalReq
    ? (finalReq.headers || []).filter((h) => h.enabled !== false && h.key)
    : [];
  const failTrace = response.trace || [];

  const copyText = async (text, tip) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast && onToast(tip);
    } catch (e) {
      onToast && onToast('复制失败：' + e.message);
    }
  };

  return (
    <div className="response-panel">
      <div className="response-status">
        <span className="status-tag status-bad">请求失败</span>
        {explain.code && <span className="fail-code-tag">{explain.code}</span>}
        {response.timeMs != null && <span className="meta">{response.timeMs} ms</span>}
        {explain.phaseLabel && <span className="meta">失败于：{explain.phaseLabel}</span>}
        <span className="flex-spacer" />
        {historyBtn}
        {layoutBtn}
      </div>
      <div className="fail-view">
        <div className="fail-card">
          <div className="fail-title">
            <span className="fail-icon"><JbIcon name="warning" size={20} /></span>
            <span>{explain.title}</span>
          </div>
          <div className="fail-raw-row">
            <pre className="fail-raw">{response.error || '（无错误详情）'}</pre>
            <button
              className="icon-btn"
              title="复制错误信息"
              onClick={() => copyText(
                [explain.title, response.error, explain.code ? `错误码: ${explain.code}` : '', explain.phaseLabel ? `阶段: ${explain.phaseLabel}` : ''].filter(Boolean).join('\n'),
                '已复制完整错误信息'
              )}
            ><JbIcon name="copy" size={14} /></button>
          </div>
          {response.errorStack && (
            <details className="fail-stack-details">
              <summary>错误堆栈</summary>
              <pre className="fail-raw fail-stack">{response.errorStack}</pre>
            </details>
          )}
          {explain.suggestions.length > 0 && (
            <div className="fail-suggests">
              <div className="fail-suggests-title">排查建议</div>
              {explain.suggestions.map((s, i) => (
                <div key={i} className="fail-suggest-item"><span className="fail-suggest-dot">•</span>{s}</div>
              ))}
            </div>
          )}
          <div className="fail-actions">
            {onRetry && <button className="btn-primary" onClick={onRetry}>重试</button>}
            {explain.sslRelated && onRetryNoSsl && (
              <button className="btn-secondary" onClick={onRetryNoSsl}>关闭 SSL 校验并重试</button>
            )}
            {finalReq && (
              <button className="btn-secondary" onClick={() => copyText(toCurl(finalReq), 'cURL 命令已复制')}>复制 cURL</button>
            )}
            {onOpenConsole && <button className="btn-secondary" onClick={onOpenConsole}>查看控制台日志</button>}
          </div>
        </div>

        {finalReq && (
          <details className="fail-section" open>
            <summary>实际发送的请求（变量已替换）</summary>
            <div className="fail-req-line">
              <span className={`method method-${finalReq.method}`}>{finalReq.method}</span>
              <span className="fail-req-url">{failUrl}</span>
              <button
                className="icon-btn"
                title="复制最终 URL"
                onClick={() => copyText(failUrl, '已复制最终 URL')}
              ><JbIcon name="copy" size={14} /></button>
            </div>
            {(finalReq.proxy || finalReq.timeoutMs) && (
              <div className="fail-req-meta">
                {finalReq.timeoutMs ? <span className="meta">超时：{finalReq.timeoutMs} ms</span> : null}
                {finalReq.proxy ? <span className="meta">代理：{finalReq.proxy}</span> : null}
              </div>
            )}
            {sentHeaders.length > 0 && (
              <table className="headers-table">
                <tbody>
                  {sentHeaders.map((h, i) => (
                    <tr key={i}>
                      <td className="header-key">{h.key}</td>
                      <td className="header-value">{h.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        )}

        {failTrace.length > 0 && (
          <details className="fail-section">
            <summary>失败前的重定向链路（{failTrace.length} 跳）</summary>
            <TraceView trace={failTrace} />
          </details>
        )}

        {scriptResult && <ScriptResultView result={scriptResult} />}
      </div>
    </div>
  );
}

/** 把 Params 表合进 URL，还原实际发出的最终地址（与 httpClient 拼接逻辑一致） */
function buildSentUrl(finalReq) {
  if (!finalReq) return '';
  try {
    const u = new URL(finalReq.url);
    for (const p of finalReq.params || []) {
      if (p.key) u.searchParams.delete(p.key);
    }
    for (const p of finalReq.params || []) {
      if (p.enabled !== false && p.key) u.searchParams.append(p.key, p.value ?? '');
    }
    return u.toString();
  } catch (e) {
    return finalReq.url || '';
  }
}

/** JSON Tree 虚拟滚动视图：只渲染可视区域行，万级节点秒开；右键节点可复制值/路径/提取为变量 */
const TREE_ROW_H = 22;
const TREE_BUFFER = 8;

/** 按 '$.a.b.0' 形式路径取子节点值（轻量实现，键名含 '.' 时不保证准确） */
function getByPath(data, path) {
  if (path === '$') return data;
  let cur = data;
  for (const p of path.slice(2).split('.')) {
    if (cur == null) return undefined;
    cur = cur[Array.isArray(cur) ? Number(p) : p];
  }
  return cur;
}

/** 将内部路径 $.data.list.0.name 转为 JS 访问路径 data.list[0].name */
function pathToAccessor(internalPath) {
  if (internalPath === '$') return '';
  const parts = internalPath.slice(2).split('.');
  let result = '';
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      result += `[${p}]`;
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p)) {
      result += (result ? '.' : '') + p;
    } else {
      result += `["${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    }
  }
  return result;
}

function JsonTree({ data, onExtractVariable, onInsertAssertion, onToast }) {
  const scrollRef = useRef(null);
  const expandedRef = useRef(new Set());
  const [, setTick] = useState(0);
  const [menu, setMenu] = useState(null); // { path, x, y }

  // 右键菜单：点击外部 / Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openMenu = (e, path) => {
    e.preventDefault();
    setMenu({ path, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 160) });
  };

  const copyText = async (text, tip) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast && onToast(tip);
    } catch (e) {
      onToast && onToast('复制失败：' + e.message);
    }
  };

  const menuValue = menu ? getByPath(data, menu.path) : undefined;
  const menuIsLeaf = menu && (menuValue === null || typeof menuValue !== 'object');

  // 初始化：默认展开前两层
  useEffect(() => {
    const expanded = new Set();
    (function init(d, path, depth) {
      if (d === null || typeof d !== 'object' || depth > 1) return;
      expanded.add(path);
      const entries = Array.isArray(d) ? d.map((v, i) => [i, v]) : Object.entries(d);
      for (const [k, v] of entries) init(v, path + '.' + k, depth + 1);
    })(data, '$', 0);
    expandedRef.current = expanded;
    setTick(1);
  }, [data]);

  const toggle = useCallback((path) => {
    const s = expandedRef.current;
    if (s.has(path)) s.delete(path); else s.add(path);
    setTick((t) => t + 1);
  }, []);

  // 扁平化：只遍历已展开节点，生成可视行列表
  const rows = useMemo(() => {
    const result = [];
    const expanded = expandedRef.current;
    (function walk(d, path, depth, name) {
      if (d === null || typeof d !== 'object') {
        result.push({ depth, name, value: d, expandable: false, path });
        return;
      }
      const isArr = Array.isArray(d);
      const entries = isArr ? d.map((v, i) => [i, v]) : Object.entries(d);
      const br = isArr ? ['[', ']'] : ['{', '}'];
      const isExp = expanded.has(path);
      result.push({ depth, name, expandable: true, expanded: isExp, count: entries.length, bracket: br[0], path });
      if (isExp) {
        for (const [k, v] of entries) walk(v, path + '.' + k, depth + 1, k);
        result.push({ depth, closing: true, bracket: br[1], path });
      }
    })(data, '$', 0, undefined);
    return result;
  }, [data, expandedRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // 虚拟滚动：只渲染可视区域 + 上下缓冲行
  const onScroll = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  const scrollTop = scrollRef.current ? scrollRef.current.scrollTop : 0;
  const clientH = scrollRef.current ? scrollRef.current.clientHeight : 600;
  const totalH = rows.length * TREE_ROW_H;
  const startIdx = Math.max(0, Math.floor(scrollTop / TREE_ROW_H) - TREE_BUFFER);
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + clientH) / TREE_ROW_H) + TREE_BUFFER);
  const visible = rows.slice(startIdx, endIdx);

  return (
    <div className="jt-vscroll" ref={scrollRef} onScroll={onScroll}>
      <div style={{ height: totalH, position: 'relative' }}>
        {visible.map((row, i) => {
          const idx = startIdx + i;
          const top = idx * TREE_ROW_H;
          if (row.closing) {
            return (
              <div key={row.path + '/c'} className="jt-row" style={{ position: 'absolute', top, left: 0, right: 0, height: TREE_ROW_H, paddingLeft: row.depth * 16 }}>
                <span className="jt-toggle-placeholder" />
                <span className="jt-bracket">{row.bracket}</span>
              </div>
            );
          }
          if (!row.expandable) {
            return (
              <div key={row.path} className="jt-row" style={{ position: 'absolute', top, left: 0, right: 0, height: TREE_ROW_H, paddingLeft: row.depth * 16 }} onContextMenu={(e) => openMenu(e, row.path)}>
                <span className="jt-toggle-placeholder" />
                {row.name !== undefined && (
                  <span className="jt-key">{typeof row.name === 'number' ? row.name : `"${row.name}"`}<span className="jt-colon">: </span></span>
                )}
                <span className={`jt-val jt-${row.value === null ? 'null' : typeof row.value}`}>
                  {typeof row.value === 'string' ? `"${row.value}"` : String(row.value)}
                </span>
              </div>
            );
          }
          return (
            <div key={row.path} className="jt-row jt-clickable" style={{ position: 'absolute', top, left: 0, right: 0, height: TREE_ROW_H, paddingLeft: row.depth * 16 }} onClick={() => toggle(row.path)} onContextMenu={(e) => openMenu(e, row.path)}>
              <span className="jt-toggle"><JbIcon name={row.expanded ? 'chevron-down' : 'chevron-right'} size={11} /></span>
              {row.name !== undefined && (
                <span className="jt-key">{typeof row.name === 'number' ? row.name : `"${row.name}"`}<span className="jt-colon">: </span></span>
              )}
              <span className="jt-bracket">{row.bracket}</span>
              {!row.expanded && <span className="jt-ellipsis">{'\u2026'} {row.count} 项</span>}
            </div>
          );
        })}
      </div>
      {menu && (
        <div className="ctx-menu" style={{ position: 'fixed', left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ctx-item"
            onClick={() => {
              const v = menuValue;
              copyText(typeof v === 'string' ? v : JSON.stringify(v, null, 2), '已复制节点值');
              setMenu(null);
            }}
          >复制值</div>
          <div className="ctx-item" onClick={() => { copyText(menu.path, '已复制节点路径'); setMenu(null); }}>复制路径（{menu.path.length > 24 ? '…' + menu.path.slice(-22) : menu.path}）</div>
          {menuIsLeaf && onExtractVariable && (
            <div
              className="ctx-item"
              onClick={() => {
                const seg = menu.path.split('.').filter((s) => s !== '$' && !/^\d+$/.test(s));
                onExtractVariable(String(menuValue ?? ''), seg[seg.length - 1] || 'extracted');
                setMenu(null);
              }}
            >提取为环境变量…</div>
          )}
          {onInsertAssertion && menu.path !== '$' && (
            <>
              <div className="ctx-sep" />
              {menuIsLeaf && (
                <div
                  className="ctx-item"
                  onClick={() => {
                    const accessor = pathToAccessor(menu.path);
                    const val = menuValue;
                    const valStr = typeof val === 'string' ? `'${val.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(val);
                    const lastKey = menu.path.split('.').pop();
                    const label = /^\d+$/.test(lastKey) ? accessor : lastKey;
                    const code = `rm.test('${label} 应为 ${typeof val === 'string' ? val.slice(0, 20) : val}', () => {\n  rm.expect(rm.response.json().${accessor}).toBe(${valStr});\n});`;
                    onInsertAssertion(code);
                    setMenu(null);
                  }}
                >断言此字段值</div>
              )}
              <div
                className="ctx-item"
                onClick={() => {
                  const accessor = pathToAccessor(menu.path);
                  const code = `rm.test('应包含 ${accessor}', () => {\n  rm.expect(rm.response.json().${accessor}).toBeDefined();\n});`;
                  onInsertAssertion(code);
                  setMenu(null);
                }}
              >断言字段存在</div>
              {menuIsLeaf && (
                <div
                  className="ctx-item"
                  onClick={() => {
                    const accessor = pathToAccessor(menu.path);
                    const val = menuValue;
                    const typeStr = val === null ? 'object' : typeof val;
                    const code = `rm.test('${accessor} 应为 ${typeStr}', () => {\n  rm.expect(typeof rm.response.json().${accessor}).toBe('${typeStr}');\n});`;
                    onInsertAssertion(code);
                    setMenu(null);
                  }}
                >断言字段类型</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 预览视图：图片（data URL）/ HTML（沙箱 iframe）/ PDF */
function PreviewView({ response, contentType }) {
  const ct = String(contentType || '').split(';')[0].trim();
  if (/^image\//i.test(ct) && response.bodyBase64) {
    return (
      <div className="preview-view">
        <img className="preview-img" src={`data:${ct};base64,${response.bodyBase64}`} alt="响应图片预览" />
        <div className="env-hint">图片预览（{ct}，{formatSize(response.sizeBytes)}），可用上方下载按钮保存原文件</div>
      </div>
    );
  }
  if (/pdf/i.test(ct) && response.bodyBase64) {
    return <iframe className="preview-frame" src={`data:application/pdf;base64,${response.bodyBase64}`} title="PDF 预览" />;
  }
  if (/html/i.test(ct)) {
    // 沙箱 iframe：禁脚本禁同源，仅静态渲染
    return <iframe className="preview-frame" sandbox="" srcDoc={response.body} title="HTML 预览" />;
  }
  return <div className="empty-hint" style={{ padding: 12 }}>该 Content-Type（{ct || '未知'}）暂不支持预览</div>;
}

/** JSON 优先美化后再逐行对比，非 JSON 按原文对比 */
function tryPretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return String(text ?? ''); }
}

/** Diff 视图：当前响应与本标签历史响应逐行对比，可切换对比基准 */
function DiffView({ response, bases }) {
  const [baseId, setBaseId] = useState(bases.length ? bases[0].id : null);
  const base = bases.find((h) => h.id === baseId) || bases[0] || null;

  const diff = useMemo(() => {
    if (!base) return null;
    return diffLines(tryPretty(base.response.body), tryPretty(response.body));
  }, [base, response]);
  const stats = diff ? diffStats(diff) : { added: 0, removed: 0 };

  if (!base) return <div className="empty-hint" style={{ padding: 12 }}>本标签暂无可对比的历史响应</div>;
  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="meta">对比基准：</span>
        <select className="diff-base-select" value={base.id} onChange={(e) => setBaseId(e.target.value)}>
          {bases.map((h) => (
            <option key={h.id} value={h.id}>{h.time}（{h.response.status} / {h.response.timeMs} ms）</option>
          ))}
        </select>
        <span className="diff-stat diff-stat-add">+{stats.added}</span>
        <span className="diff-stat diff-stat-del">−{stats.removed}</span>
        {stats.added === 0 && stats.removed === 0 && <span className="meta">内容完全一致</span>}
      </div>
      <pre className="diff-body">
        {diff.map((d, i) => (
          <div key={i} className={`diff-line diff-${d.type}`}>
            <span className="diff-sign">{d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}</span>{d.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Hex 视图：offset + 16 字节十六进制 + ASCII，超长截断 */
function HexView({ text }) {
  const { rows, truncated, total } = useMemo(() => {
    const bytes = new TextEncoder().encode(text || '');
    const limit = Math.min(bytes.length, HEX_MAX_BYTES);
    const rows = [];
    for (let off = 0; off < limit; off += 16) {
      const chunk = bytes.subarray(off, Math.min(off + 16, limit));
      let hex = '';
      let ascii = '';
      for (let i = 0; i < 16; i++) {
        if (i < chunk.length) {
          hex += chunk[i].toString(16).padStart(2, '0') + ' ';
          ascii += chunk[i] >= 0x20 && chunk[i] <= 0x7e ? String.fromCharCode(chunk[i]) : '·';
        } else {
          hex += '   ';
        }
        if (i === 7) hex += ' ';
      }
      rows.push({ offset: off.toString(16).padStart(8, '0'), hex, ascii });
    }
    return { rows, truncated: bytes.length > HEX_MAX_BYTES, total: bytes.length };
  }, [text]);

  return (
    <div className="hex-view">
      {rows.map((r) => (
        <div key={r.offset} className="hex-row">
          <span className="hex-offset">{r.offset}</span>
          <span className="hex-bytes">{r.hex}</span>
          <span className="hex-ascii">{r.ascii}</span>
        </div>
      ))}
      {truncated && <div className="env-hint">已截断，仅显示前 {HEX_MAX_BYTES / 1024} KB（共 {(total / 1024).toFixed(1)} KB）</div>}
    </div>
  );
}

/** 阶段耗时条形图：DNS / TCP / TLS / 首字节 / 下载 */
function TimingsView({ timings }) {
  const stages = [
    { key: 'dns', label: 'DNS 解析' },
    { key: 'connect', label: 'TCP 连接' },
    { key: 'tls', label: 'TLS 握手' },
    { key: 'ttfb', label: '等待首字节' },
    { key: 'download', label: '内容下载' }
  ].filter((s) => timings[s.key] != null && timings[s.key] >= 0);
  const total = Math.max(timings.total || 1, 1);

  return (
    <div className="timings-view">
      {stages.map((s) => (
        <div key={s.key} className="timing-row">
          <span className="timing-label">{s.label}</span>
          <div className="timing-bar-track">
            <div
              className="timing-bar"
              style={{ width: `${Math.max((timings[s.key] / total) * 100, 0.5)}%` }}
            />
          </div>
          <span className="timing-value">{timings[s.key]} ms</span>
        </div>
      ))}
      <div className="timing-row timing-total">
        <span className="timing-label">总耗时（末跳）</span>
        <div className="timing-bar-track" />
        <span className="timing-value">{timings.total} ms</span>
      </div>
      <div className="env-hint">复用连接时无 DNS / 连接 / 握手阶段；多次重定向时仅统计最后一跳</div>
    </div>
  );
}

/** 重定向链路列表 */
function TraceView({ trace }) {
  return (
    <div className="trace-view">
      {trace.map((t, i) => (
        <div key={i} className="trace-item">
          <span className="trace-index">{i + 1}</span>
          <span className={`status-tag ${t.status < 400 ? 'status-good' : 'status-bad'}`}>{t.status}</span>
          <span className={`method method-${t.method}`}>{t.method}</span>
          <span className="trace-url" title={t.url}>{t.url}</span>
          <span className="meta">{t.timeMs} ms</span>
        </div>
      ))}
    </div>
  );
}

/** 脚本执行结果：测试断言 + 控制台输出 + 脚本错误 */
function ScriptResultView({ result }) {
  const { tests, logs, errors } = result;
  return (
    <div className="script-result">
      {errors.map((err, i) => (
        <div key={'e' + i} className="script-error">脚本错误：{err}</div>
      ))}
      {tests.length > 0 && (
        <div className="test-list">
          {tests.map((t, i) => (
            <div key={i} className={`test-item ${t.passed ? 'test-pass' : 'test-fail'}`}>
              <span>{t.passed ? <JbIcon name="checkmark" size={12} /> : <JbIcon name="close" size={12} />}</span>
              <span>{t.name}</span>
              {!t.passed && t.error && <span className="test-error-msg">— {t.error}</span>}
            </div>
          ))}
        </div>
      )}
      {logs.length > 0 && (
        <div className="script-console">
          <div className="script-title">控制台输出</div>
          {logs.map((l, i) => (
            <pre key={i} className={`console-line console-${l.level}`}>{l.text}</pre>
          ))}
        </div>
      )}
      {tests.length === 0 && logs.length === 0 && errors.length === 0 && (
        <div className="empty-hint">脚本未产生测试或输出</div>
      )}
    </div>
  );
}

/** Content-Type → 下载文件扩展名 */
function contentTypeToExt(ct) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('json')) return 'json';
  if (t.includes('html')) return 'html';
  if (t.includes('xml')) return 'xml';
  if (t.includes('csv')) return 'csv';
  if (t.includes('javascript')) return 'js';
  if (t.includes('css')) return 'css';
  if (t.includes('markdown')) return 'md';
  if (t.includes('text/')) return 'txt';
  return 'bin';
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
