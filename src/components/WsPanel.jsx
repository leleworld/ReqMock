import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import KeyValueEditor from './KeyValueEditor.jsx';
import VarInput from './VarInput.jsx';
import { JbIcon } from './Icons.jsx';
import { resolveVars } from '../utils/envUtil.js';
import { tabIn } from '../utils/motionPresets.js';

/** App.jsx 中 rtState 事件数组的保留上限，超出后丢弃最旧消息（用于界面提示） */
export const RT_MAX_EVENTS = 500;

/** 消息内容：JSON 自动 Pretty，其余原样展示 */
export function formatRtData(data) {
  const text = String(data ?? '');
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch (e) { /* 非 JSON 原样返回 */ }
  }
  return text;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB') + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/** 已连接时长 mm:ss（超过 1 小时补 h:mm:ss） */
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 高亮匹配关键字：将文本中匹配 keyword 的部分用 <mark> 包裹 */
function HighlightText({ text, keyword }) {
  if (!keyword) return <>{text}</>;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  // split with capturing group: even indices = non-match, odd indices = match
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i} className="ws-search-hit">{part}</mark> : part
      )}
    </>
  );
}

/**
 * 统一过滤规则：
 * WS 用 all/sent/received；SSE 用 all/data/sys（只收不发）；关键字同时匹配消息内容与事件名
 */
function filterRtEvents(events, filterText, filterType) {
  let list = events;
  if (filterType === 'sent') {
    list = list.filter((evt) => evt.direction === 'out');
  } else if (filterType === 'received' || filterType === 'data') {
    list = list.filter((evt) => evt.direction === 'in');
  } else if (filterType === 'sys') {
    list = list.filter((evt) => evt.direction === 'sys');
  }
  if (filterText) {
    const kw = filterText.toLowerCase();
    list = list.filter((evt) =>
      String(evt.data ?? '').toLowerCase().includes(kw) ||
      String(evt.event ?? '').toLowerCase().includes(kw)
    );
  }
  return list;
}

/**
 * WS / SSE 共用消息时间线（新消息在底部）：
 * - 自动跟随底部；用户上滚即暂停跟随并显示「回到底部」悬浮按钮（含未读增量计数）
 * - 单条消息悬停复制；关键字命中高亮（含事件名）
 * - 无过滤条件时空态显示 emptyHint（修复此前 SSE 误显「无匹配消息」）
 */
export function RtTimeline({ events, emptyHint, filterText = '', filterType = 'all' }) {
  const listRef = useRef(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [pending, setPending] = useState(0);
  const prevLenRef = useRef(0);
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const copyTimerRef = useRef(null);

  const filtered = useMemo(
    () => filterRtEvents(events, filterText, filterType),
    [events, filterText, filterType]
  );

  // 过滤条件变化时恢复跟随，避免带着旧滚动状态判断
  useEffect(() => {
    pinnedRef.current = true;
    setPinned(true);
    setPending(0);
    prevLenRef.current = filtered.length;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterText, filterType]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  // 新消息：跟随时滚底；暂停时累计未读
  useEffect(() => {
    const el = listRef.current;
    const added = filtered.length - prevLenRef.current;
    prevLenRef.current = filtered.length;
    if (added > 0) {
      if (pinnedRef.current) {
        if (el) el.scrollTop = el.scrollHeight;
      } else {
        setPending((p) => p + added);
      }
    } else if (added < 0) {
      setPending(0);
    }
  }, [filtered.length]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== pinnedRef.current) {
      pinnedRef.current = atBottom;
      setPinned(atBottom);
      if (atBottom) setPending(0);
    }
  };

  const jumpToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
    setPending(0);
  };

  const copyMsg = (evt, i) => {
    const text = String(evt.data ?? '');
    const flash = () => {
      setCopiedIdx(i);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedIdx(-1), 1200);
    };
    const fallback = () => {
      // 剪贴板 API 不可用/被拒（窗口无焦点等）时回退 execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flash(); } catch (e) { /* 静默 */ }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(fallback);
    } else {
      fallback();
    }
  };

  const filtering = !!filterText || (filterType && filterType !== 'all');

  return (
    <div className="rt-timeline-wrap">
      <div className="rt-timeline" ref={listRef} onScroll={handleScroll}>
        {filtered.length === 0 && (
          <div className="empty-hint">{filtering ? '无匹配消息' : emptyHint}</div>
        )}
        {filtered.map((evt, i) => (
          <motion.div key={i} className={`rt-msg rt-msg-${evt.direction}${evt.type !== 'message' ? ' rt-msg-sys' : ''}`} {...tabIn}>
            <span className="rt-msg-dir" title={evt.direction === 'out' ? '发送' : evt.direction === 'in' ? '接收' : '状态'}>
              {evt.direction === 'out' ? '↑' : evt.direction === 'in' ? '↓' : '◦'}
            </span>
            <span className="rt-msg-time">{fmtTime(evt.time)}</span>
            {evt.event && evt.event !== 'message' && <span className="rt-msg-event">{evt.event}</span>}
            <pre className="rt-msg-data"><HighlightText text={formatRtData(evt.data)} keyword={filterText} /></pre>
            <button
              className={`rt-msg-copy${copiedIdx === i ? ' rt-copied' : ''}`}
              title={copiedIdx === i ? '已复制' : '复制本条内容'}
              onClick={() => copyMsg(evt, i)}
            >
              <JbIcon name={copiedIdx === i ? 'checkmark' : 'copy'} size={11} />
            </button>
          </motion.div>
        ))}
      </div>
      {!pinned && (
        <button className="rt-jump" onClick={jumpToBottom}>
          ↓ 回到底部{pending > 0 ? ` · ${pending} 条新消息` : ''}
        </button>
      )}
    </div>
  );
}

/** 时间线工具行：计数 + 上限提示 + 重置/导出/清空 */
function RtEventHead({ title, count, onReset, onExport, onClear, showReset }) {
  return (
    <div className="rt-timeline-head">
      <span className="script-title">{title}（{count}）</span>
      {count >= RT_MAX_EVENTS && (
        <span className="rt-cap-hint" title={`消息超过 ${RT_MAX_EVENTS} 条后自动丢弃最旧消息`}>仅保留最近 {RT_MAX_EVENTS} 条</span>
      )}
      <span className="flex-spacer" />
      {showReset && <button className="btn-text" onClick={onReset}>重置</button>}
      <button className="btn-text" onClick={onExport} title="导出全部消息为文本文件">导出</button>
      <button className="btn-text" onClick={onClear}>清空</button>
    </div>
  );
}

/** 搜索 + 方向/类型过滤按钮组（选项由各面板传入） */
function RtSearchBar({ filterText, setFilterText, filterType, setFilterType, options }) {
  return (
    <div className="ws-search-bar body-search-bar">
      <input
        className="body-search-input"
        placeholder="搜索消息内容…"
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        spellCheck={false}
      />
      {options.map((o) => (
        <button
          key={o.value}
          className={`search-toggle ${filterType === o.value ? 'on' : ''}`}
          onClick={() => setFilterType(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

/** 导出全部消息为 txt（走主进程 file:export 保存对话框） */
async function exportRtEvents(kindLabel, tabId, events, onToast) {
  if (!events.length) {
    onToast('暂无可导出的消息');
    return;
  }
  const lines = events.map((e) => {
    const dir = e.direction === 'out' ? '↑ 发送' : e.direction === 'in' ? '↓ 接收' : '◦ 系统';
    const ev = e.event && e.event !== 'message' ? ` [${e.event}]` : '';
    return `${new Date(e.time).toISOString()} ${dir}${ev} ${String(e.data ?? '').replace(/\n/g, ' ⏎ ')}`;
  });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const res = await window.api.exportFile({
    defaultName: `${kindLabel}-${stamp}.txt`,
    content: lines.join('\n'),
    encoding: 'utf8'
  });
  if (res && res.ok) onToast('已导出：' + res.filePath, 'success');
  else if (res && !res.canceled) onToast('导出失败：' + (res.error || '未知错误'), 'error');
}

/** 连接状态 + 已连接时长计时（每秒刷新） */
function useRtStatus(state) {
  const status = (state && state.status) || 'idle';
  const connected = status === 'connected';
  const connecting = status === 'connecting';
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!connected) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [connected]);
  const duration = connected && state && state.connectedAt ? fmtDur(now - state.connectedAt) : '';
  return { status, connected, connecting, duration };
}

/** URL 栏公共部分：状态点 + 时长 + 连接/断开按钮 */
function RtStatusDot({ status, duration }) {
  const cls = status === 'connected' ? 'rt-on'
    : status === 'connecting' ? 'rt-connecting'
    : status === 'error' ? 'rt-err' : '';
  const tip = { connected: '已连接', connecting: '连接中', error: '连接异常', idle: '未连接', disconnected: '已断开' }[status] || '未连接';
  return (
    <>
      <span className={`rt-status-dot ${cls}`} title={tip} />
      {duration && <span className="rt-duration" title="已连接时长">{duration}</span>}
    </>
  );
}

/**
 * WebSocket 面板：URL 栏（连接/断开 + 状态点 + 时长）+ Header/子协议 + 消息时间线 + 发送区（↑ 召回历史）
 * 连接由主进程 WsManager 持有（连接 id = 标签 id），消息经 ws:event 推送、由 App 汇总后传入
 */
export default function WsPanel({ tabId, config, state, varNames = [], varMap = {}, onChangeConfig, onClear, onToast }) {
  const { status, connected, connecting, duration } = useRtStatus(state);
  const events = (state && state.events) || [];
  const [draft, setDraft] = useState('');
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('all');
  // 发送历史（组件会话级，最近 50 条），histIdx=-1 表示未处于召回状态
  const [hist, setHist] = useState([]);
  const histIdxRef = useRef(-1);
  const set = (patch) => onChangeConfig({ ...config, ...patch });

  const handleConnect = async () => {
    if (!config.url) {
      onToast('请先填写 WebSocket URL');
      return;
    }
    const protocols = String(config.protocols || '').split(',').map((s) => s.trim()).filter(Boolean);
    const res = await window.api.wsConnect({
      id: tabId,
      url: resolveVars(config.url, varMap),
      headers: (config.headers || []).map((h) => ({
        ...h,
        key: resolveVars(h.key, varMap),
        value: resolveVars(h.value, varMap)
      })),
      protocols
    });
    if (!res.ok) onToast('连接失败：' + res.error, 'error');
  };

  const handleSend = async () => {
    if (!draft) return;
    const res = await window.api.wsSend(tabId, draft);
    if (res.ok) {
      setHist((h) => [draft, ...h].slice(0, 50));
      histIdxRef.current = -1;
      setDraft('');
    } else {
      onToast('发送失败:' + res.error, 'error');
    }
  };

  /** ↑/↓ 在光标位于首/末行边界时召回/前进发送历史 */
  const handleDraftKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    const el = e.currentTarget;
    if (e.key === 'ArrowUp' && hist.length && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      histIdxRef.current = Math.min(histIdxRef.current + 1, hist.length - 1);
      setDraft(hist[histIdxRef.current]);
    } else if (e.key === 'ArrowDown' && histIdxRef.current >= 0 && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
      e.preventDefault();
      histIdxRef.current -= 1;
      setDraft(histIdxRef.current < 0 ? '' : hist[histIdxRef.current]);
    }
  };

  return (
    <div className="rt-panel">
      <div className="request-bar">
        <RtStatusDot status={status} duration={duration} />
        <input
          className="rt-name-input"
          value={config.name || ''}
          placeholder="连接名称"
          onChange={(e) => set({ name: e.target.value })}
          spellCheck={false}
        />
        <VarInput
          className="url-input"
          placeholder="ws://localhost:8080/socket 或 wss://…（支持 {{变量}}）"
          value={config.url || ''}
          varNames={varNames}
          varMap={varMap}
          highlight
          onChange={(url) => set({ url })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !connected && !connecting) handleConnect(); }}
        />
        {connected ? (
          <button className="btn-primary btn-cancel" onClick={() => window.api.wsClose(tabId)}>断开</button>
        ) : (
          <button className={`btn-primary${connecting ? ' btn-connecting' : ''}`} disabled={connecting} onClick={handleConnect}>
            {connecting ? '连接中…' : '连接'}
          </button>
        )}
      </div>

      <div className="rt-body">
        <div className="rt-side">
          <div className="script-title">握手 Headers（支持 {'{{变量}}'}，连接时生效）</div>
          <KeyValueEditor
            rows={config.headers || []}
            onChange={(rows) => set({ headers: rows })}
            keyPlaceholder="Header 名"
            valuePlaceholder="Header 值"
            varNames={varNames}
            varMap={varMap}
          />
          <div className="rt-opt-row">
            <div className="script-title" title="Sec-WebSocket-Protocol，逗号分隔，连接时生效">子协议（逗号分隔，连接时生效）</div>
            <input
              className="rt-opt-input"
              value={config.protocols || ''}
              placeholder="如 chat, realtime"
              onChange={(e) => set({ protocols: e.target.value })}
              spellCheck={false}
            />
          </div>
        </div>
        <div className="rt-main">
          <RtEventHead
            title="消息"
            count={events.length}
            showReset={!!filterText || filterType !== 'all'}
            onReset={() => { setFilterText(''); setFilterType('all'); }}
            onExport={() => exportRtEvents('ws-messages', tabId, events, onToast)}
            onClear={onClear}
          />
          <RtSearchBar
            filterText={filterText} setFilterText={setFilterText}
            filterType={filterType} setFilterType={setFilterType}
            options={[
              { value: 'all', label: '全部' },
              { value: 'sent', label: '↑ 发送' },
              { value: 'received', label: '↓ 接收' }
            ]}
          />
          <RtTimeline events={events} emptyHint="尚无消息，连接后开始记录收发内容" filterText={filterText} filterType={filterType} />
          <div className="rt-send">
            <textarea
              className="rt-send-input"
              placeholder={'发送内容（文本 / JSON），Ctrl+Enter 发送，空内容时 ↑ 召回发送历史'}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); histIdxRef.current = -1; }}
              onKeyDown={handleDraftKey}
              disabled={!connected}
              spellCheck={false}
            />
            <button className="btn-primary" disabled={!connected || !draft} onClick={handleSend}>发送</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { RtEventHead, RtSearchBar, exportRtEvents, useRtStatus, RtStatusDot };
