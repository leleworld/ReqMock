import React, { useState, useRef, useMemo, useCallback } from 'react';
import { collectRunnableRequests, parseRunnerData, runCollection, exportRunReport } from '../utils/runnerUtil.js';
import { findNode } from '../utils/collectionUtil.js';
import { executeRequest } from '../utils/requestPipeline.js';
import { JbIcon } from './Icons.jsx';
import EmptyGuide from './EmptyGuide.jsx';

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
  const [concurrency, setConcurrency] = useState(1);
  const [dataRows, setDataRows] = useState([]);
  const [dataName, setDataName] = useState('');
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('all'); // all | failed
  const stopRef = useRef(false);
  const startTimeRef = useRef(null);

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

  /**
   * 并发池执行：维护一个 running Set，每当有请求完成就从队列中取下一个执行。
   * 结果按原始顺序排列。
   */
  const runConcurrent = useCallback(async (runItems, ctx) => {
    const totalIterations = dataRows.length > 0 ? dataRows.length : Math.max(1, iterations);
    // 构造扁平任务队列：[{iter, idx, request, path}]
    const queue = [];
    for (let iter = 0; iter < totalIterations; iter++) {
      const rowVars = dataRows.length > 0 ? dataRows[iter] : {};
      for (let idx = 0; idx < runItems.length; idx++) {
        queue.push({ iter, idx, request: runItems[idx].request, path: runItems[idx].path, rowVars });
      }
    }
    const results = new Array(queue.length);
    let nextIndex = 0;
    let doneCount = 0;

    const runNext = async () => {
      while (nextIndex < queue.length) {
        if (stopRef.current) return;
        const myIndex = nextIndex++;
        const task = queue[myIndex];
        const iterVarMap = { ...ctx.varMap, ...task.rowVars };
        const started = Date.now();
        let entry;
        try {
          const r = await executeRequest(task.request, { ...ctx, varMap: iterVarMap });
          const failedTests = r.tests.filter((t) => !t.passed);
          entry = {
            iteration: task.iter + 1,
            requestId: task.request.id,
            name: task.request.name || task.request.url,
            method: task.request.method,
            url: r.finalReq.url,
            path: task.path,
            ok: r.result.ok,
            status: r.result.ok ? r.result.status : 'ERR',
            timeMs: r.result.timeMs ?? (Date.now() - started),
            sizeBytes: r.result.sizeBytes,
            error: r.result.ok ? null : (r.result.error || '未知错误'),
            tests: r.tests,
            scriptErrors: r.errors,
            passed: r.result.ok && failedTests.length === 0 && r.errors.length === 0
          };
        } catch (e) {
          entry = {
            iteration: task.iter + 1,
            requestId: task.request.id,
            name: task.request.name || task.request.url,
            method: task.request.method,
            url: task.request.url,
            path: task.path,
            ok: false, status: 'ERR',
            timeMs: Date.now() - started, sizeBytes: null,
            error: e.message, tests: [], scriptErrors: [e.message], passed: false
          };
        }
        results[myIndex] = entry;
        doneCount++;
        // 按原始顺序输出已连续完成的条目
        setEntries(results.slice(0, doneCount).filter(Boolean));
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      workers.push(runNext());
    }
    await Promise.all(workers);
    return results.filter(Boolean);
  }, [concurrency, dataRows, iterations]);

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
    startTimeRef.current = Date.now();

    if (concurrency > 1) {
      // 并发模式
      const allEntries = await runConcurrent(runItems, buildCtx());
      const testsTotal = allEntries.reduce((s, e) => s + e.tests.length, 0);
      const testsPassed = allEntries.reduce((s, e) => s + e.tests.filter((t) => t.passed).length, 0);
      const totalTimeMs = Date.now() - startTimeRef.current;
      setSummary({
        total: allEntries.length,
        passed: allEntries.filter((e) => e.passed).length,
        failed: allEntries.filter((e) => !e.passed).length,
        testsTotal,
        testsPassed,
        testsFailed: testsTotal - testsPassed,
        totalTimeMs,
        stopped: stopRef.current,
        iterations: dataRows.length > 0 ? dataRows.length : Math.max(1, iterations)
      });
    } else {
      // 串行模式（保持原逻辑）
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
    }
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
          {items.length === 0 && (
            <EmptyGuide
              title="该节点下没有可运行的请求"
              desc="批量运行会递归收集该集合 / 文件夹及其子文件夹里的请求；未保存的请求与 Mock 占位请求不在范围内。先在集合树里把请求拖进来，或新建请求后 Ctrl+S 保存。"
            />
          )}
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
        <label className="inline-label runner-opt">
          并发数
          <input
            className="num-input concurrency-input" type="number" min={1} max={10}
            value={concurrency} disabled={running}
            onChange={(e) => setConcurrency(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
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
            <button className="btn-primary" onClick={handleRun}><JbIcon name="play" size={13} /> 运行</button>
          ) : (
            <button className="btn-danger" onClick={handleStop}><JbIcon name="stop" size={13} /> 停止</button>
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
          {entry.passed ? <JbIcon name="checkmark" size={11} /> : <JbIcon name="close" size={11} />}
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
              {t.passed ? <JbIcon name="checkmark" size={11} /> : <JbIcon name="close" size={11} />} {t.name}{t.error ? `：${t.error}` : ''}
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
