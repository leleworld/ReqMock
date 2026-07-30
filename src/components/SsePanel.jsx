import React from 'react';
import KeyValueEditor from './KeyValueEditor.jsx';
import VarInput from './VarInput.jsx';
import { resolveVars } from '../utils/envUtil.js';
import { RtTimeline } from './WsPanel.jsx';

/**
 * SSE 面板：URL 栏（连接/断开 + 状态点）+ Header 编辑 + 事件时间线（只收不发）
 * 连接由主进程 SseManager 持有（连接 id = 标签 id），事件经 sse:event 推送、由 App 汇总后传入
 */
export default function SsePanel({ tabId, config, state, varNames = [], varMap = {}, onChangeConfig, onClear, onToast }) {
  const connected = !!(state && state.connected);
  const events = (state && state.events) || [];
  const set = (patch) => onChangeConfig({ ...config, ...patch });

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
      }))
    });
    if (!res.ok) onToast('连接失败：' + res.error, 'error');
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
          placeholder="http://localhost:8080/events（Accept: text/event-stream，支持 {{变量}}）"
          value={config.url || ''}
          varNames={varNames}
          varMap={varMap}
          highlight
          onChange={(url) => set({ url })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !connected) handleConnect(); }}
        />
        {connected ? (
          <button className="btn-primary btn-cancel" onClick={() => window.api.sseClose(tabId)}>断开</button>
        ) : (
          <button className="btn-primary" onClick={handleConnect}>连接</button>
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
        </div>
        <div className="rt-main">
          <div className="rt-timeline-head">
            <span className="script-title">事件（{events.length}）</span>
            <span className="flex-spacer" />
            <button className="btn-text" onClick={onClear}>清空</button>
          </div>
          <RtTimeline events={events} emptyHint="尚无事件，连接后开始记录服务端推送" />
        </div>
      </div>
    </div>
  );
}
