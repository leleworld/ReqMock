import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * 应用内实时 AI 分析面板：进页面自动跑一次，也可点「重新分析」。
 * 数据由主进程 ai:analyze 从同一 analyze() 引擎取，流式回传渲染。
 * @param {string} kind 'report'|'endpoints'（全局）或 'endpoint'（单接口）
 * @param {object} filter {days,src,host}
 * @param {string} endpointKey kind='endpoint' 时的接口 key
 */
export default function AiPanel({ kind = 'report', filter, endpointKey }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const curId = useRef(null);
  const unsub = useRef(null);

  const run = useCallback(async () => {
    if (unsub.current) { unsub.current(); unsub.current = null; }
    const id = 'ai-' + (++seq.current) + '-' + Date.now();
    curId.current = id;
    setErr(''); setText(''); setBusy(true);
    unsub.current = window.api.onAiDelta((p) => { if (p.id === id) setText((t) => t + p.text); });
    try {
      const r = await window.api.aiAnalyze({ id, kind, filter, key: endpointKey });
      if (!r.ok && !r.aborted) setErr(r.error || '分析失败');
    } catch (e) {
      setErr((e && e.message) || String(e));
    } finally {
      if (curId.current === id) {
        setBusy(false);
        if (unsub.current) { unsub.current(); unsub.current = null; }
      }
    }
  }, [kind, endpointKey, JSON.stringify(filter)]);

  useEffect(() => {
    run();
    return () => { if (unsub.current) unsub.current(); if (curId.current) window.api.aiAbort(curId.current); };
  }, [run]);

  const stop = () => { if (curId.current) window.api.aiAbort(curId.current); setBusy(false); };

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="ai-title">AI 分析{endpointKey ? '（当前接口）' : '（全局）'}</span>
        <span className="ai-spacer" />
        {busy && <button className="btn-secondary ai-btn" onClick={stop}>停止</button>}
        <button className="btn-secondary ai-btn" onClick={run} disabled={busy}>{busy ? '分析中…' : '重新分析'}</button>
      </div>
      {err && <div className="ai-err">{err}</div>}
      {text
        ? <pre className="ai-text">{text}</pre>
        : busy
          ? <div className="ai-empty">正在调用千问分析…</div>
          : !err && <div className="ai-empty">（无返回，检查 设置 → AI 分析 是否已启用并填好 Base URL / API Key）</div>}
    </div>
  );
}
