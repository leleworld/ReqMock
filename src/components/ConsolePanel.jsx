import React, { useState } from 'react';
import { JbIcon } from './Icons.jsx';

/**
 * 底部控制台抽屉：请求日志（可展开 Headers 详情）/ 脚本 console 输出 / Mock 命中日志
 * 数据均为会话级（不持久化），由 App 在发送管线与 Mock 日志回调中采集
 */
export default function ConsolePanel({
  requestLogs, scriptLogs, mockLogs,
  onClearRequests, onClearScripts, onClearMock, onClose
}) {
  const [tab, setTab] = useState('requests');
  // 已展开详情的请求日志 id 集合
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearCurrent = () => {
    if (tab === 'requests') onClearRequests();
    else if (tab === 'script') onClearScripts();
    else onClearMock();
  };

  return (
    <div className="console-drawer">
      <div className="console-head">
        <span className="console-title"><JbIcon name="terminal" size={13} /> 控制台</span>
        <div className="console-tabs">
          <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
            请求 ({requestLogs.length})
          </button>
          <button className={tab === 'script' ? 'active' : ''} onClick={() => setTab('script')}>
            脚本 ({scriptLogs.length})
          </button>
          <button className={tab === 'mock' ? 'active' : ''} onClick={() => setTab('mock')}>
            Mock ({mockLogs.length})
          </button>
        </div>
        <span className="flex-spacer" />
        <button className="btn-text" onClick={clearCurrent}>清空</button>
        <button className="btn-text" title="关闭控制台" onClick={onClose}><JbIcon name="close" size={12} /></button>
      </div>

      <div className="console-body">
        {tab === 'requests' && (
          <>
            {requestLogs.length === 0 && <div className="empty-hint">发送请求后在此记录最终请求与响应摘要</div>}
            {requestLogs.map((log) => (
              <div key={log.id}>
                <div className="console-row console-clickable" onClick={() => toggleExpand(log.id)}>
                  <span className="console-time">{log.time}</span>
                  <span className={`method method-${log.method}`}>{log.method}</span>
                  <span className="console-url" title={log.url}>{log.url}</span>
                  {log.ok ? (
                    <span className={`status-tag ${log.status < 400 ? 'status-good' : 'status-bad'}`}>{log.status}</span>
                  ) : (
                    <span className="status-tag status-bad">失败</span>
                  )}
                  {log.timeMs != null && <span className="meta">{log.timeMs} ms</span>}
                </div>
                {expanded.has(log.id) && (
                  <div className="console-detail">
                    {!log.ok && log.error && <div className="console-error">{log.error}</div>}
                    <div className="console-kv-title">请求 Headers（变量替换后）</div>
                    {(log.requestHeaders || []).length === 0 && <div className="env-hint">（无）</div>}
                    {(log.requestHeaders || []).map((h, i) => (
                      <div key={i} className="console-kv">
                        <span className="console-kv-key">{h.key}</span>
                        <span className="console-kv-val">{h.value}</span>
                      </div>
                    ))}
                    <div className="console-kv-title">响应 Headers</div>
                    {Object.entries(log.responseHeaders || {}).map(([k, v]) => (
                      <div key={k} className="console-kv">
                        <span className="console-kv-key">{k}</span>
                        <span className="console-kv-val">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'script' && (
          <>
            {scriptLogs.length === 0 && <div className="empty-hint">脚本中的 console.log 输出将汇总在此</div>}
            {scriptLogs.map((log) => (
              <div key={log.id} className={`console-script-row console-${log.level}`}>
                <span className="console-time">{log.time}</span>
                <span className="console-source" title={log.source}>{log.source}</span>
                <pre className="console-text">{log.text}</pre>
              </div>
            ))}
          </>
        )}

        {tab === 'mock' && (
          <>
            {mockLogs.length === 0 && <div className="empty-hint">Mock 服务命中记录将展示在此</div>}
            {mockLogs.map((log, i) => (
              <div key={i} className="console-row">
                <span className="console-time">{log.time}</span>
                <span className={`method method-${log.method}`}>{log.method}</span>
                <span className="console-url" title={log.path}>{log.path}</span>
                <span className={`status-tag ${log.status < 400 ? 'status-good' : 'status-bad'}`}>{log.status}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
