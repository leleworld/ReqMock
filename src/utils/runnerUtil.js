/**
 * Collection Runner：批量执行集合/文件夹内请求（UI 无关）
 * - collectRunnableRequests：深度优先收集节点下所有请求（文件夹顺序 → 请求顺序）
 * - parseRunnerData：解析 CSV / JSON 数组为数据驱动的迭代变量行
 * - runCollection：迭代 × 请求 双层循环执行，逐条回调进度，支持中止与延迟
 */
import { executeRequest } from './requestPipeline.js';

/** 深度优先收集节点（集合或文件夹）下所有请求，附带路径便于结果展示 */
export function collectRunnableRequests(node, basePath = []) {
  const path = [...basePath, node.name];
  let out = (node.requests || []).map((r) => ({ request: r, path }));
  for (const f of node.folders || []) {
    out = out.concat(collectRunnableRequests(f, path));
  }
  return out;
}

/**
 * 解析数据文件内容为变量行数组 [{k:v}, ...]。
 * 支持：JSON 数组（对象元素）/ CSV（首行为表头，支持双引号转义）。
 * 空内容返回 []；无法解析抛错。
 */
export function parseRunnerData(content) {
  const text = (content || '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON 数据文件解析失败：' + e.message);
    }
    if (!Array.isArray(data)) throw new Error('JSON 数据文件必须是数组');
    return data.map((row) => {
      const flat = {};
      for (const [k, v] of Object.entries(row || {})) {
        flat[k] = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      return flat;
    });
  }
  return parseCsv(text);
}

/** CSV 解析：首行表头；支持 "a,b" 双引号包裹与 "" 转义；\r\n / \n 均可 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { pushField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { pushField(); pushRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  pushField();
  if (row.length > 1 || row[0] !== '') pushRow();
  if (rows.length < 1) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => { if (h) obj[h] = r[idx] ?? ''; });
      return obj;
    });
}

/**
 * 批量执行。
 * @param {object} opts
 *   - items: collectRunnableRequests 的返回值
 *   - iterations: 迭代次数（无数据行时生效，默认 1）
 *   - dataRows: 数据驱动变量行（非空时迭代次数 = 行数）
 *   - delayMs: 每个请求间延迟
 *   - ctx: executeRequest 的上下文（collections/varMap/settings/cookieJar/send）
 *   - onProgress: (entry) => void 每个请求完成回调
 *   - shouldStop: () => bool 中止查询
 * @returns {Promise<{entries, summary}>}
 */
export async function runCollection(opts) {
  const {
    items,
    iterations = 1,
    dataRows = [],
    delayMs = 0,
    ctx,
    onProgress,
    shouldStop
  } = opts;

  const totalIterations = dataRows.length > 0 ? dataRows.length : Math.max(1, iterations);
  const entries = [];
  let stopped = false;

  for (let iter = 0; iter < totalIterations; iter += 1) {
    const rowVars = dataRows.length > 0 ? dataRows[iter] : {};
    // 迭代内 rm.env.set 的变量向后续请求传递
    let iterVarMap = { ...ctx.varMap, ...rowVars };
    for (let idx = 0; idx < items.length; idx += 1) {
      if (shouldStop && shouldStop()) { stopped = true; break; }
      if (delayMs > 0 && entries.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const { request, path } = items[idx];
      const started = Date.now();
      let entry;
      try {
        const r = await executeRequest(request, { ...ctx, varMap: iterVarMap });
        iterVarMap = { ...iterVarMap, ...r.envSet };
        r.envUnset.forEach((k) => delete iterVarMap[k]);
        const failedTests = r.tests.filter((t) => !t.passed);
        entry = {
          iteration: iter + 1,
          requestId: request.id,
          name: request.name || request.url,
          method: request.method,
          url: r.finalReq.url,
          path,
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
          iteration: iter + 1,
          requestId: request.id,
          name: request.name || request.url,
          method: request.method,
          url: request.url,
          path,
          ok: false,
          status: 'ERR',
          timeMs: Date.now() - started,
          sizeBytes: null,
          error: e.message,
          tests: [],
          scriptErrors: [e.message],
          passed: false
        };
      }
      entries.push(entry);
      if (onProgress) onProgress(entry);
    }
    if (stopped) break;
  }

  const testsTotal = entries.reduce((s, e) => s + e.tests.length, 0);
  const testsPassed = entries.reduce((s, e) => s + e.tests.filter((t) => t.passed).length, 0);
  const summary = {
    total: entries.length,
    passed: entries.filter((e) => e.passed).length,
    failed: entries.filter((e) => !e.passed).length,
    testsTotal,
    testsPassed,
    testsFailed: testsTotal - testsPassed,
    totalTimeMs: entries.reduce((s, e) => s + (e.timeMs || 0), 0),
    stopped,
    iterations: totalIterations
  };
  return { entries, summary };
}

/** 结果导出为 Markdown 报告 */
export function exportRunReport(runMeta, entries, summary) {
  const lines = [];
  lines.push(`# 运行报告：${runMeta.name}`);
  lines.push('');
  lines.push(`- 时间：${runMeta.time}`);
  lines.push(`- 迭代：${summary.iterations}${summary.stopped ? '（手动中止）' : ''}`);
  lines.push(`- 请求：${summary.total} 个，通过 ${summary.passed}，失败 ${summary.failed}`);
  lines.push(`- 断言：${summary.testsTotal} 条，通过 ${summary.testsPassed}，失败 ${summary.testsFailed}`);
  lines.push(`- 总耗时：${summary.totalTimeMs} ms`);
  lines.push('');
  lines.push('| # | 迭代 | 请求 | 方法 | 状态 | 耗时 | 结果 | 失败原因 |');
  lines.push('|---|------|------|------|------|------|------|----------|');
  entries.forEach((e, i) => {
    const failReason = e.error ||
      e.tests.filter((t) => !t.passed).map((t) => `${t.name}: ${t.error}`).join('; ') ||
      e.scriptErrors.join('; ') || '';
    lines.push(`| ${i + 1} | ${e.iteration} | ${escapeMd(e.name)} | ${e.method} | ${e.status} | ${e.timeMs} ms | ${e.passed ? '✅' : '❌'} | ${escapeMd(failReason)} |`);
  });
  return lines.join('\n');
}

function escapeMd(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
