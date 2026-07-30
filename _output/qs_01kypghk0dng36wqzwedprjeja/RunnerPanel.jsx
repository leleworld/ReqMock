import React, { useState, useRef, useMemo } from 'react';
import { collectRunnableRequests, parseRunnerData, runCollection, exportRunReport } from '../utils/runnerUtil.js';
import { findNode } from '../utils/collectionUtil.js';

/**
 * Collection Runner 面板：
 * 左侧 = 运行配置（目标节点请求清单 + 迭代/延迟/数据文件），右侧 = 运行结果与统计
 */
export default function RunnerPanel(props) {
  const { nodeId, collections, buildCtx, onToast } = props;

  const node = findNode(collections, nodeId);
  const items = useMemo(() => (node ? collectRunnableRequests(node) : []), [node]);

  const [selected, setSelected] = useState(() => new Set(items.map((it) => it.request.id)));
  const [iterations, setIterations] = useState(1);
  const [delayMs, setDelayMs] = useState(0);
  const [dataRows, setDataRows] = useState([]);
  const [dataName, setDataName] = useState('');
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('all'); // all | failed
  const stopRef = useRef(false);

  if (!node) {
    return <div className="response-placeholder">目标集合/文件夹已删除</div>;
  }

  const toggleReq = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((it) => it.request.id))));
  };

  const handlePickData = async () => {
    const res = await window.api.importFile();
    if (!res.ok) {
      if (!res.canceled) onToast('读取失败：' + res.error, 'error');
      return;
    }
    try {
      const rows = parseRunnerData(res.content);
      setDataRows(rows);
      setDataName(`${rows.length} 行数据`);
      onToast(`已加载数据文件：${rows.length} 行`, 'success');
    } catch (e) {
      onToast(e.message, 'error');
    }
  };

  const handleRun = async () => {
    const runItems = items.filter((it) => selected.has(it.request.id));
    if (runItems.length === 0) {
      onToast('请至少勾选一个请求');
      return;
    }
    stopRef.current = false;
    setRunning(true);
    setEntries([]);
    setSummary(null);
    const r = await runCollection({
      items: runItems,
      iterations,
      dataRows,
      delayMs,
      ctx: buildCtx(),
      onProgress: (entry) => setEntries((prev) => [...prev, entry]),
      shouldStop: () => stopRef.current
    });
    setSummary(r.summary);
    setRunning(false);
  };

  const handleStop = () => { stopRef.current = true; };

  const handleExport = async () => {
    if (!summary) return;
    const content = exportRunReport(
      { name: node.name, time: new Date().toLocaleString() },
      entries, summary
    );
    const res = await window.api.exportFile({ defaultName: `${node.name}-run-report.md`, content });
    if (res.ok) onToast('已导出：' + res.filePath, 'success');
    else if (!res.canceled) onToast('导出失败：' + res.error, 'error');
  };

  const shownEntries = filter === 'failed' ? entries.filter((e) => !e.passed) : entries;
  const doneCount = entries.length;
  const totalCount = (dataRows.length > 0 ? dataRows.length : Math.max(1, iterations)) *
    items.filter((it) => selected.has(it.request.id)).length;

  return (
    <div className="runner-panel">
      <div className="runner-config">
        <div className="runner-section-title">运行目标</div>
        <div className="runner-target">{node.name}（{items.length} 个请求）</div>

        <div className="runner-req-list">
          <label className="runner-req-row runner-req-head">
            <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} />
            <span className="item-name">全选</span>
          </label>
          {items.map(({ request, path }) => (
            <label key={request.id} className="runner-req-row" title={path.join(' › ')}>
              <input
                type="checkbox"
                checked={selected.has(request.id)}
                onChange={() => toggleReq(request.id)}
              />
              <span className={`method method-${request.method}`}>{request.method}</span>
              <span className="item-name" title={request.url}>{request.name || request.url}</span>
            </label>
          ))}
          {items.length === 0 && <div className="empty-hint">该节点下没有请求</div>}
        </div>

        <div className="runner-section-title">运行选项</div>
        <label className="inline-label runner-opt">
          迭代次数
          <input
            className="num-input" type="number" min={1} max={1000}
            value={iterations} disabled={dataRows.length > 0 || running}
            onChange={(e) => setIterations(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
        </label>
        <label className="inline-label runner-opt">
          请求间隔(ms)
          <input
            className="num-input" type="number" min={0}
            value={delayMs} disabled={running}
            onChange={(e) => setDelayMs(Math.max(0, parseInt(e.target.value, 10) || 0))}
          />
        </label>
        <div className="runner-opt runner-data-row">
          <button className="btn-secondary" disabled={running} onClick={handlePickData}>数据文件…</button>
          {dataRows.length > 0 ? (
            <span className="meta">
              {dataName}（迭代 = 行数）
              <button className="btn-text" disabled={running} onClick={() => { setDataRows([]); setDataName(''); }}>清除</button>
            </span>
          ) : (
            <span className="meta">CSV / JSON 数组，按行注入 {'{{变量}}'}</span>
          )}
        </div>

        <div className="runner-actions">
          {!running ? (
            <button className="btn-primary" onClick={handleRun}>▶ 运行</button>
          ) : (
            <button className="btn-danger" onClick={handleStop}>■ 停止</button>
          )}
          {summary && !running && (
            <button className="btn-secondary" onClick={handleExport}>导出报告</button>
          )}
        </div>
      </div>

      <div className="runner-results">
        <div className="runner-section-title">
          运行结果
          {running && <span className="meta">　{doneCount} / {totalCount}</span>}
          <span className="flex-spacer" />
          <span className="runner-filter">
            <button className={`btn-text ${filter === 'all' ? 'runner-filter-on' : ''}`} onClick={() => setFilter('all')}>全部</button>
            <button className={`btn-text ${filter === 'failed' ? 'runner-filter-on' : ''}`} onClick={() => setFilter('failed')}>仅失败</button>
          </span>
        </div>

        {running && (
          <div className="runner-progress">
            <div className="runner-progress-bar" style={{ width: totalCount ? `${(doneCount / totalCount) * 100}%` : '0%' }} />
          </div>
        )}

        {summary && (
          <div className="runner-summary">
            <span className="runner-stat">请求 <b>{summary.total}</b></span>
            <span className="runner-stat runner-stat-ok">通过 <b>{summary.passed}</b></span>
            <span className={`runner-stat ${summary.failed > 0 ? 'runner-stat-bad' : ''}`}>失败 <b>{summary.failed}</b></span>
            <span className="runner-stat">断言 <b>{summary.testsPassed}/{summary.testsTotal}</b></span>
            <span className="runner-stat">耗时 <b>{summary.totalTimeMs} ms</b></span>
            {summary.stopped && <span className="runner-stat runner-stat-bad">已中止</span>}
          </div>
        )}

        <div className="runner-entry-list">
          {shownEntries.length === 0 && !running && (
            <div className="empty-hint">{entries.length === 0 ? '点击"运行"开始批量执行' : '无失败项'}</div>
          )}
          {shownEntries.map((e, i) => (
            <RunEntry key={`${e.iteration}-${e.requestId}-${i}`} entry={e} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RunEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const failedTests = entry.tests.filter((t) => !t.passed);
  const hasDetail = entry.error || failedTests.length > 0 || entry.scriptErrors.length > 0 || entry.tests.length > 0;
  return (
    <div className={`runner-entry ${entry.passed ? '' : 'runner-entry-failed'}`}>
      <div className="runner-entry-row" onClick={() => hasDetail && setOpen(!open)}>
        <span className={`runner-badge ${entry.passed ? 'runner-badge-ok' : 'runner-badge-bad'}`}>
          {entry.passed ? '✓' : '✗'}
        </span>
        <span className="meta">#{entry.iteration}</span>
        <span className={`method method-${entry.method}`}>{entry.method}</span>
        <span className="item-name" title={entry.url}>{entry.name}</span>
        <span className={`status-tag ${entry.status === 'ERR' || entry.status >= 400 ? 'status-bad' : 'status-good'}`}>
          {entry.status}
        </span>
        <span className="meta">{entry.timeMs} ms</span>
        {entry.tests.length > 0 && (
          <span className="meta">断言 {entry.tests.filter((t) => t.passed).length}/{entry.tests.length}</span>
        )}
      </div>
      {open && hasDetail && (
        <div className="runner-entry-detail">
          {entry.error && <div className="runner-detail-line runner-detail-err">网络错误：{entry.error}</div>}
          {entry.tests.map((t, i) => (
            <div key={i} className={`runner-detail-line ${t.passed ? 'runner-detail-ok' : 'runner-detail-err'}`}>
              {t.passed ? '✓' : '✗'} {t.name}{t.error ? `：${t.error}` : ''}
            </div>
          ))}
          {entry.scriptErrors.map((s, i) => (
            <div key={i} className="runner-detail-line runner-detail-err">脚本异常：{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}
