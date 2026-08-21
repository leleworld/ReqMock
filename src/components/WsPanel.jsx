import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import KeyValueEditor from './KeyValueEditor.jsx';
import VarInput from './VarInput.jsx';
import { resolveVars } from '../utils/envUtil.js';
import { tabIn } from '../utils/motionPresets.js';

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

/** WS / SSE 共用消息时间线：方向标记 + 时间 + 内容（新消息在底部，自动跟随滚动） */
export function RtTimeline({ events, emptyHint, filterText, filterType }) {
  const listRef = useRef(null);

  // 根据 filterText 和 filterType 过滤消息
  const filteredEvents = useMemo(() => {
    let list = events;
    if (filterType === 'sent') {
      list = list.filter((evt) => evt.direction === 'out');
    } else if (filterType === 'received') {
      list = list.filter((evt) => evt.direction === 'in');
    }
    if (filterText) {
      const kw = filterText.toLowerCase();
      list = list.filter((evt) => {
        const data = String(evt.data ?? '').toLowerCase();
        return data.includes(kw);
      });
    }
    return list;
  }, [events, filterText, filterType]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filteredEvents.length]);

  return (
    <div className="rt-timeline" ref={listRef}>
      {filteredEvents.length === 0 && <div className="empty-hint">{filterText || filterType !== 'all' ? '无匹配消息' : emptyHint}</div>}
      {filteredEvents.map((evt, i) => (
        <motion.div key={i} className={`rt-msg rt-msg-${evt.direction}${evt.type !== 'message' ? ' rt-msg-sys' : ''}`} {...tabIn}>
          <span className="rt-msg-dir" title={evt.direction === 'out' ? '发送' : evt.direction === 'in' ? '接收' : '状态'}>
            {evt.direction === 'out' ? '↑' : evt.direction === 'in' ? '↓' : '◦'}
          </span>
          <span className="rt-msg-time">{fmtTime(evt.time)}</span>
          {evt.event && evt.event !== 'message' && <span className="rt-msg-event">{evt.event}</span>}
          <pre className="rt-msg-data"><HighlightText text={formatRtData(evt.data)} keyword={filterText} /></pre>
        </motion.div>
      ))}
    </div>
  );
}

/**
 * WebSocket 面板：URL 栏（连接/断开 + 状态点）+ Header 编辑 + 消息时间线 + 发送区
 * 连接由主进程 WsManager 持有（连接 id = 标签 id），消息经 ws:event 推送、由 App 汇总后传入
 */
export default function WsPanel({ tabId, config, state, varNames = [], varMap = {}, onChangeConfig, onClear, onToast }) {
  const connected = !!(state && state.connected);
  const events = (state && state.events) || [];
  const [draft, setDraft] = useState('');
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('all');
  const set = (patch) => onChangeConfig({ ...config, ...patch });

  const handleConnect = async () => {
    if (!config.url) {
      onToast('请先填写 WebSocket URL');
      return;
    }
    const res = await window.api.wsConnect({
      id: tabId,
      url: resolveVars(config.url, varMap),
      headers: (config.headers || []).map((h) => ({
        ...h,
        key: resolveVars(h.key, varMap),
        value: resolveVars(h.value, varMap)
      }))
    });
    if (!res.ok) onToast('连接失败：' + res.error, 'error');
  };

  const handleSend = async () => {
    if (!draft) return;
    const res = await window.api.wsSend(tabId, draft);
    if (res.ok) setDraft('');
    else onToast('发送失败:' + res.error, 'error');
  };

  return (
    <div className="rt-panel">
      <div className="request-bar">
        <span className={`rt-status-dot ${connected ? 'rt-on' : ''}`} title={connected ? '已连接' : '未连接'} />
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
          onKeyDown={(e) => { if (e.key === 'Enter' && !connected) handleConnect(); }}
        />
        {connected ? (
          <button className="btn-primary btn-cancel" onClick={() => window.api.wsClose(tabId)}>断开</button>
        ) : (
          <button className="btn-primary" onClick={handleConnect}>连接</button>
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
        </div>
        <div className="rt-main">
          <div className="rt-timeline-head">
            <span className="script-title">消息（{events.length}）</span>
            <span className="flex-spacer" />
            <button className="btn-text" onClick={() => { setFilterText(''); setFilterType('all'); }}>重置</button>
            <button className="btn-text" onClick={onClear}>清空</button>
          </div>
          <div className="ws-search-bar body-search-bar">
            <input
              className="body-search-input"
              placeholder="搜索消息内容…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              spellCheck={false}
            />
            <button className={`search-toggle ${filterType === 'all' ? 'on' : ''}`} onClick={() => setFilterType('all')}>全部</button>
            <button className={`search-toggle ${filterType === 'sent' ? 'on' : ''}`} onClick={() => setFilterType('sent')}>↑ 发送</button>
            <button className={`search-toggle ${filterType === 'received' ? 'on' : ''}`} onClick={() => setFilterType('received')}>↓ 接收</button>
          </div>
          <RtTimeline events={events} emptyHint="尚无消息，连接后开始记录收发内容" filterText={filterText} filterType={filterType} />
          <div className="rt-send">
            <textarea
              className="rt-send-input"
              placeholder={'发送内容（文本 / JSON），Ctrl+Enter 发送'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); } }}
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
