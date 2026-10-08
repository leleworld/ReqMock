/**
 * 流量埋点 + 分析引擎（单一事实源）
 *
 * 分层：
 *   1) 采集：httpClient.cjs 出口调用 recordMetrics()，写 userData/reqmock-metrics.jsonl（轮转）。
 *      记录含 params/headers/body/respBody（截断），支撑钻取与响应差异。
 *   2) 归一：readMetrics + historyToMetrics → 统一 run 结构（GUI 旧 history 与埋点同构）。
 *   3) 分析：analyze(runs, opts) —— 纯函数，零外部依赖，Node（Markdown 导出）与浏览器（HTML 交互）
 *      共用同一份逻辑（HTML 里通过 analyze.toString() 注入），保证「界面结论」与「导出结论」一致。
 *   4) 渲染：见 report-html.cjs（renderReportHTML 四视图 / renderReportMarkdown）。
 */
const fs = require('fs');

const MAX_BYTES = 8 * 1024 * 1024;
const RESP_KEEP = 3000;   // 响应体留存上限（钻取/对比够用，控制体积）
let metricsFile = null;

function configureMetrics(file) { metricsFile = file; }

function compactKv(rows) {
  const out = [];
  for (const r of rows || []) if (r && r.key && r.enabled !== false) out.push({ k: r.key, v: String(r.value == null ? '' : r.value) });
  return out;
}

/** 从任意形态 URL（含 {{var}} 前缀 / scheme://host / 裸 host）提取纯 API 路径，用于跨环境归组 */
function apiPath(raw) {
  raw = String(raw || '').split('?')[0];
  let i = raw.indexOf('//');
  if (i >= 0) i = raw.indexOf('/', i + 2);
  else i = raw.indexOf('/');
  return i >= 0 ? raw.slice(i) : raw;
}

/** 记录一次请求（httpClient 出口调用） */
function recordMetrics(payload, result) {
  if (!metricsFile) return;
  try {
    let u = null;
    try { u = new URL(payload.url || ''); } catch { u = null; }
    const rec = {
      ts: Date.now(),
      src: payload.__src || 'gui',
      method: payload.method || 'GET',
      host: u ? u.host : '',
      path: apiPath(payload.url),
      status: result && result.ok ? result.status : 0,
      ok: !!(result && result.ok && result.status >= 200 && result.status < 400),
      timeMs: (result && result.timeMs) || 0,
      sizeBytes: (result && result.sizeBytes) || 0,
      err: result && !result.ok ? (result.errorCode || String(result.error || '').slice(0, 80)) : '',
      params: compactKv(payload.params),
      headers: compactKv(payload.headers),
      body: String(payload.body || '').slice(0, RESP_KEEP),
      respBody: result && result.body ? String(result.body).slice(0, RESP_KEEP) : ''
    };
    try {
      if (fs.existsSync(metricsFile) && fs.statSync(metricsFile).size > MAX_BYTES) {
        const bak = metricsFile + '.1';
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
        fs.renameSync(metricsFile, bak);
      }
    } catch { /* 轮转失败不影响写入 */ }
    fs.appendFileSync(metricsFile, JSON.stringify(rec) + '\n', 'utf8');
  } catch { /* 埋点失败绝不影响主流程 */ }
}

/** 读取埋点记录（jsonl + .1），升序 */
function readMetrics(file) {
  const target = file || metricsFile;
  if (!target) return [];
  const files = [target + '.1', target].filter((f) => fs.existsSync(f));
  const out = [];
  for (const f of files) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch { /* 跳过残行 */ }
      }
    } catch { /* 读失败跳过 */ }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/** store.history（GUI 旧记录）→ 统一 run 结构 */
function historyToMetrics(history) {
  return (history || []).map((x) => {
    let u = null;
    try { u = new URL(String(x.url || '').replace(/\{\{[\w.-]+\}\}/g, '')); } catch { u = null; }
    const snap = x.responseSnapshot || {};
    return {
      ts: x.time || 0,
      src: 'gui',
      method: x.method || 'GET',
      host: u ? u.host : '',
      path: apiPath(x.url),
      status: x.status || 0,
      ok: x.status >= 200 && x.status < 400,
      timeMs: x.timeMs || 0,
      sizeBytes: x.sizeBytes || 0,
      err: x.status >= 400 || !x.status ? String(x.status || 'ERR') : '',
      params: compactKv(x.params),
      headers: compactKv(x.headers),
      body: String(x.body || '').slice(0, RESP_KEEP),
      respBody: String(snap.body || '').slice(0, RESP_KEEP)
    };
  });
}

/** 归一任意来源记录 → run（补齐缺失字段，兼容旧埋点无 params/body） */
function normalizeRun(r) {
  return {
    ts: r.ts || 0, src: r.src || 'gui', method: r.method || 'GET',
    host: r.host || '', path: r.path || '',
    status: r.status || 0, ok: !!r.ok,
    timeMs: r.timeMs || 0, sizeBytes: r.sizeBytes || 0, err: r.err || '',
    params: r.params || [], headers: r.headers || [],
    body: r.body || '', respBody: r.respBody || ''
  };
}

// ─────────────────────────────────────────────────────────
// 纯函数区：不引用模块级变量/外部依赖，可 toString() 注入浏览器与 Node 共用。
// ─────────────────────────────────────────────────────────

/** 递归 JSON diff，返回 [路径, 旧, 新]；过滤抖动字段 */
function diffJson(a, b, path, out) {
  path = path || ''; out = out || [];
  var NOISE = { signatureServer: 1, traceSign: 1 };
  if (a === b) return out;
  var pa = path || '$';
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { out.push([pa, a, b]); return out; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push([pa, JSON.stringify(a).slice(0, 60), JSON.stringify(b).slice(0, 60)]); return out; }
  var seen = {}; var keys = [];
  Object.keys(a).concat(Object.keys(b)).forEach(function (k) { if (!seen[k]) { seen[k] = 1; keys.push(k); } });
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (NOISE[k]) continue;
    if (!(k in a)) out.push([pa + '.' + k, '(无)', b[k]]);
    else if (!(k in b)) out.push([pa + '.' + k, a[k], '(无)']);
    else diffJson(a[k], b[k], pa + '.' + k, out);
  }
  return out;
}

function fmtDiffValue(v, max) {
  max = max || 60;
  if (v === '(无)') return v;
  var s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 参数级 diff（两组 [{k,v}] → 变动列表） */
function diffParams(pa, pb) {
  var A = {}, B = {};
  (pa || []).forEach(function (x) { A[x.k] = x.v; });
  (pb || []).forEach(function (x) { B[x.k] = x.v; });
  var seen = {}; var keys = [];
  Object.keys(A).concat(Object.keys(B)).forEach(function (k) { if (!seen[k]) { seen[k] = 1; keys.push(k); } });
  var out = [];
  keys.sort().forEach(function (k) {
    if (!(k in A)) out.push({ t: 'add', k: k, to: B[k] });
    else if (!(k in B)) out.push({ t: 'del', k: k, from: A[k] });
    else if (String(A[k]) !== String(B[k])) out.push({ t: 'mod', k: k, from: A[k], to: B[k] });
  });
  return out;
}

/**
 * 分析引擎（纯函数）。runs: 归一 run 数组；opts: {from,to,src,host}。
 * 返回 {summary, timeseries, histogram, topSlow, heat, insights, endpoints}
 */
function analyze(runs, opts) {
  opts = opts || {};
  function pctl(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0; }
  function ekey(r) { return r.method + ' ' + r.path; }

  var f = (runs || []).filter(function (r) {
    if (opts.from && r.ts < opts.from) return false;
    if (opts.to && r.ts > opts.to) return false;
    if (opts.src && opts.src !== 'all' && r.src !== opts.src) return false;
    if (opts.host && opts.host !== 'all' && r.host !== opts.host) return false;
    return true;
  });

  var ts = f.map(function (r) { return r.timeMs; }).sort(function (a, b) { return a - b; });
  var ok = f.filter(function (r) { return r.ok; }).length;
  var sumMs = f.reduce(function (s, r) { return s + r.timeMs; }, 0);
  var minTs = f.length ? f[0].ts : 0, maxTs = f.length ? f[0].ts : 0;
  var bySrc = {}, hosts = {};
  f.forEach(function (r) {
    bySrc[r.src] = (bySrc[r.src] || 0) + 1;
    if (r.host) { hosts[r.host] = hosts[r.host] || { host: r.host, count: 0, fail: 0 }; hosts[r.host].count++; if (!r.ok) hosts[r.host].fail++; }
    if (r.ts < minTs) minTs = r.ts; if (r.ts > maxTs) maxTs = r.ts;
  });

  var dayMap = {};
  f.forEach(function (r) {
    var d = new Date(r.ts).toISOString().slice(0, 10);
    var e = dayMap[d] = dayMap[d] || { date: d, count: 0, fail: 0, ms: 0 };
    e.count++; if (!r.ok) e.fail++; e.ms += r.timeMs;
  });
  var timeseries = Object.keys(dayMap).sort().map(function (d) { var e = dayMap[d]; return { date: d, count: e.count, fail: e.fail, avgMs: e.count ? Math.round(e.ms / e.count) : 0 }; });

  var buckets = [[0, 100, '<100ms'], [100, 300, '100-300ms'], [300, 500, '300-500ms'], [500, 1000, '0.5-1s'], [1000, 2000, '1-2s'], [2000, Infinity, '>2s']];
  var histogram = buckets.map(function (b) { return { label: b[2], count: f.filter(function (r) { return r.timeMs >= b[0] && r.timeMs < b[1]; }).length }; });

  var epMap = {};
  f.forEach(function (r) {
    var k = ekey(r);
    var e = epMap[k] = epMap[k] || { key: k, method: r.method, path: r.path, host: r.host, count: 0, fail: 0, ms: 0, maxMs: 0, times: [], runs: [] };
    e.count++; if (!r.ok) e.fail++; e.ms += r.timeMs; e.maxMs = Math.max(e.maxMs, r.timeMs);
    e.times.push(r.timeMs);
    if (e.runs.length < 40) e.runs.push(r);
  });
  var endpoints = Object.keys(epMap).map(function (k) {
    var e = epMap[k]; var st = e.times.slice().sort(function (a, b) { return a - b; });
    return { key: e.key, method: e.method, path: e.path, host: e.host, count: e.count, fail: e.fail, ok: e.count - e.fail, failRate: e.count ? e.fail / e.count : 0, avg: e.count ? Math.round(e.ms / e.count) : 0, p95: pctl(st, 0.95), maxMs: e.maxMs, runs: e.runs.sort(function (a, b) { return b.ts - a.ts; }) };
  }).sort(function (a, b) { return b.count - a.count; });

  var topSlow = endpoints.filter(function (e) { return e.count >= 2; }).sort(function (a, b) { return b.p95 - a.p95; }).slice(0, 15);
  var heat = Object.keys(hosts).map(function (h) { return hosts[h]; }).sort(function (a, b) { return b.count - a.count; });

  var insights = [];
  if (f.length >= 6) {
    var mid = (minTs + maxTs) / 2;
    var early = f.filter(function (r) { return r.ts < mid; }), late = f.filter(function (r) { return r.ts >= mid; });
    function rate(arr) { return arr.length ? arr.filter(function (r) { return !r.ok; }).length / arr.length : 0; }
    function p95of(arr) { var s = arr.map(function (r) { return r.timeMs; }).sort(function (a, b) { return a - b; }); return pctl(s, 0.95); }
    var eRate = rate(early), lRate = rate(late), lFail = late.filter(function (r) { return !r.ok; }).length;
    if (lFail >= 3 && lRate > Math.max(eRate * 1.5, 0.1))
      insights.push({ sev: 'high', icon: '▲', title: '失败率激增', detail: '后半段失败率 ' + Math.round(lRate * 100) + '%，前半段 ' + Math.round(eRate * 100) + '%（近 ' + late.length + ' 次请求）' });
    var eP95 = p95of(early), lP95 = p95of(late);
    if (late.length >= 5 && lP95 > eP95 * 1.5 && lP95 > 500)
      insights.push({ sev: 'mid', icon: '⏱', title: '整体变慢', detail: '后半段 P95 ' + lP95 + 'ms，较前半段 ' + eP95 + 'ms 上升 ' + Math.round((lP95 / (eP95 || 1) - 1) * 100) + '%' });
    var eErr = {}, newErr = [];
    early.forEach(function (r) { if (r.err) eErr[r.err] = 1; });
    late.forEach(function (r) { if (r.err && !eErr[r.err] && newErr.indexOf(r.err) < 0) newErr.push(r.err); });
    newErr.slice(0, 5).forEach(function (code) { insights.push({ sev: 'high', icon: '✦', title: '新错误码 ' + code, detail: '后半段首次出现错误码 ' + code + '，此前未见过' }); });
  }
  endpoints.filter(function (e) { return e.count >= 3 && e.failRate > 0.3; }).slice(0, 6).forEach(function (e) {
    insights.push({ sev: 'high', icon: '✕', title: '高失败接口', detail: e.key + ' 失败 ' + e.fail + '/' + e.count + '（' + Math.round(e.failRate * 100) + '%）', key: e.key });
  });
  var gP95 = pctl(ts, 0.95);
  endpoints.filter(function (e) { return e.count >= 3 && gP95 > 0 && e.p95 > gP95 * 2; }).sort(function (a, b) { return b.p95 - a.p95; }).slice(0, 6).forEach(function (e) {
    insights.push({ sev: 'mid', icon: '⏱', title: '偏慢接口', detail: e.key + ' P95 ' + e.p95 + 'ms，为全局 ' + gP95 + 'ms 的 ' + (e.p95 / gP95).toFixed(1) + ' 倍', key: e.key });
  });
  var sevRank = { high: 0, mid: 1, info: 2 };
  insights.sort(function (a, b) { return sevRank[a.sev] - sevRank[b.sev]; });

  return {
    summary: {
      total: f.length, ok: ok, fail: f.length - ok, failRate: f.length ? (f.length - ok) / f.length : 0,
      avg: f.length ? Math.round(sumMs / f.length) : 0, p50: pctl(ts, 0.5), p95: pctl(ts, 0.95), maxMs: ts.length ? ts[ts.length - 1] : 0,
      from: minTs, to: maxTs, spanDays: maxTs && minTs ? Math.max(1, Math.round((maxTs - minTs) / 86400000)) : 0,
      endpoints: endpoints.length, hosts: heat.length, bySrc: bySrc
    },
    timeseries: timeseries, histogram: histogram, topSlow: topSlow, heat: heat, insights: insights, endpoints: endpoints
  };
}

/** 单个接口的紧凑证据块：统计 + 相邻参数变动 + 最近两次响应差异 + 错误码 */
function endpointEvidence(e) {
  const lines = [];
  lines.push(`- ${e.key}  调用${e.count} 失败${e.fail}(${Math.round((e.failRate || 0) * 100)}%) 平均${e.avg}ms P95${e.p95}ms 最慢${e.maxMs}ms`);
  const runs = (e.runs || []).slice(0, 12); // 新→旧
  // 相邻参数变动（取前几条有变化的）
  let shown = 0;
  for (let i = 0; i < runs.length - 1 && shown < 4; i++) {
    const ch = diffParams(runs[i + 1].params, runs[i].params);
    if (ch.length) {
      lines.push(`    参数变动: ${ch.slice(0, 6).map((c) => c.t === 'mod' ? `${c.k} ${c.from}→${c.to}` : c.t === 'add' ? `+${c.k}=${c.to}` : `-${c.k}`).join('; ')}`);
      shown++;
    }
  }
  // 错误码分布
  const errs = {};
  runs.forEach((r) => { if (r.err) errs[r.err] = (errs[r.err] || 0) + 1; });
  if (Object.keys(errs).length) lines.push(`    错误码: ${Object.entries(errs).map(([k, v]) => `${k}×${v}`).join(' ')}`);
  // 最近两次响应差异
  if (runs.length >= 2) {
    let ja = null, jb = null;
    try { ja = JSON.parse(runs[1].respBody); } catch { /* */ }
    try { jb = JSON.parse(runs[0].respBody); } catch { /* */ }
    if (ja && jb) {
      const ds = diffJson(ja, jb);
      if (ds.length) lines.push(`    响应差异(${ds.length}处): ${ds.slice(0, 8).map((d) => `${d[0]}: ${fmtDiffValue(d[1], 24)}→${fmtDiffValue(d[2], 24)}`).join('; ')}`);
      else lines.push(`    响应差异: 最近两次一致`);
    }
  }
  return lines.join('\n');
}

/**
 * 构建给模型的上下文（纯函数）。kind: 'report'|'endpoints'（全局） 或 'endpoint'（单接口，需 key）。
 * stats: analyze() 结果。返回一段有界的中文文本，交给模型做归因分析。
 */
function buildAiContext(kind, stats, endpointKey) {
  const s = stats.summary;
  const head = `【流量概况】时间 ${(s.from ? new Date(s.from).toLocaleString() : '-')} ~ ${(s.to ? new Date(s.to).toLocaleString() : '-')}\n` +
    `请求 ${s.total} 次，成功 ${s.ok} / 失败 ${s.fail}（失败率 ${(s.failRate * 100).toFixed(1)}%），平均 ${s.avg}ms / P50 ${s.p50}ms / P95 ${s.p95}ms / 最慢 ${s.maxMs}ms，覆盖 ${s.endpoints} 个接口 ${s.hosts} 个域名，来源 ${JSON.stringify(s.bySrc)}`;
  const ins = stats.insights.length ? `\n【规则引擎已标记的异常】\n${stats.insights.map((i) => `- [${i.sev}] ${i.title}: ${i.detail}`).join('\n')}` : '\n【规则引擎未标记异常】';

  if (kind === 'endpoint' && endpointKey) {
    const e = stats.endpoints.find((x) => x.key === endpointKey);
    if (!e) return `${head}${ins}\n\n【目标接口】${endpointKey} 无数据`;
    return `${head}${ins}\n\n【重点分析接口】\n${endpointEvidence(e)}`;
  }
  // 全局：挑失败最多 / 最慢 / 有参数或响应变化的接口
  const pick = stats.endpoints.slice()
    .sort((a, b) => (b.fail - a.fail) || (b.p95 - a.p95)).slice(0, 8);
  const body = pick.length ? pick.map(endpointEvidence).join('\n') : '（无接口数据）';
  return `${head}${ins}\n\n【接口证据（按失败/耗时排序，最多 8 个）】\n${body}`;
}

module.exports = {
  configureMetrics, recordMetrics, readMetrics, historyToMetrics, normalizeRun,
  diffJson, fmtDiffValue, diffParams, analyze, buildAiContext,
  renderReportHTML: (runs) => require('./report-html.cjs').renderReportHTML(runs, { analyze, diffJson, fmtDiffValue, diffParams }),
  renderReportMarkdown: (runs) => require('./report-html.cjs').renderReportMarkdown(runs, { analyze, diffJson, fmtDiffValue, diffParams })
};
