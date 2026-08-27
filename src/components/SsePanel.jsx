import React, { useState } from 'react';
import KeyValueEditor from './KeyValueEditor.jsx';
import VarInput from './VarInput.jsx';
import { resolveVars } from '../utils/envUtil.js';
import { RtTimeline, RtEventHead, RtSearchBar, exportRtEvents, useRtStatus, RtStatusDot } from './WsPanel.jsx';

const SSE_FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'data', label: '↓ 数据事件' },
  { value: 'sys', label: '◦ 系统事件' }
];

/**
 * SSE 面板：URL 栏（连接/断开 + 状态点 + 时长）+ Header + 搜索过滤 + 事件时间线（只收不发）
 * 连接由主进程 SseManager 持有（连接 id = 标签 id），事件经 sse:event 推送、由 App 汇总后传入
 * 支持断线自动重连（携带 Last-Event-ID 断点续推）
 */
export default function SsePanel({ tabId, config, state, varNames = [], varMap = {}, onChangeConfig, onClear, onToast }) {
  const { status, connected, connecting, duration } = useRtStatus(state);
  const events = (state && state.events) || [];
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('all');
  const set = (patch) => onChangeConfig({ ...config, ...patch });
  // 自动重连默认开启（旧配置无此字段时视为开启）
  const autoReconnect = config.autoReconnect !== false;

  const handleConnect = async () => {
    if (!config.url) {
      onToast('请先填写 SSE URL');
      return;
    }
    const res = await window.api.sseConnect({
      id: tabId,
      url: resolveVars(config.url, varMap),
      headers: (config.headers || []).map((h) => ({
        ...h,
        key: resolveVars(h.key, varMap),
        value: resolveVars(h.value, varMap)
      })),
      autoReconnect
    });
    if (!res.ok) onToast('连接失败：' + res.error, 'error');
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
          placeholder="http://localhost:8080/events（Accept: text/event-stream，支持 {{变量}}）"
          value={config.url || ''}
          varNames={varNames}
          varMap={varMap}
          highlight
          onChange={(url) => set({ url })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !connected && !connecting) handleConnect(); }}
        />
        {connected ? (
          <button className="btn-primary btn-cancel" onClick={() => window.api.sseClose(tabId)}>断开</button>
        ) : (
          <button className={`btn-primary${connecting ? ' btn-connecting' : ''}`} disabled={connecting} onClick={handleConnect}>
            {connecting ? '连接中…' : '连接'}
          </button>
        )}
      </div>

      <div className="rt-body">
        <div className="rt-side">
          <div className="script-title">请求 Headers（支持 {'{{变量}}'}，连接时生效）</div>
          <KeyValueEditor
            rows={config.headers || []}
            onChange={(rows) => set({ headers: rows })}
            keyPlaceholder="Header 名"
            valuePlaceholder="Header 值"
            varNames={varNames}
            varMap={varMap}
          />
          <div className="rt-opt-row">
            <label className="rt-opt-check">
              <input
                type="checkbox"
                checked={autoReconnect}
                onChange={(e) => set({ autoReconnect: e.target.checked })}
              />
              断线自动重连（携带 Last-Event-ID 断点续推）
            </label>
            <div className="rt-opt-hint">异常断开后按服务端 retry 间隔（缺省 3s）指数退避，封顶 15s，最多 10 次</div>
          </div>
        </div>
        <div className="rt-main">
          <RtEventHead
            title="事件"
            count={events.length}
            showReset={!!filterText || filterType !== 'all'}
            onReset={() => { setFilterText(''); setFilterType('all'); }}
            onExport={() => exportRtEvents('sse-events', tabId, events, onToast)}
            onClear={onClear}
          />
          <RtSearchBar
            filterText={filterText} setFilterText={setFilterText}
            filterType={filterType} setFilterType={setFilterType}
            options={SSE_FILTER_OPTIONS}
          />
          <RtTimeline events={events} emptyHint="尚无事件，连接后开始记录服务端推送" filterText={filterText} filterType={filterType} />
        </div>
      </div>
    </div>
  );
}
