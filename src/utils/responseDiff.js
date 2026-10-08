/**
 * 响应体结构化 diff（JSON 递归对比）
 * 与 reqmock skill 的 diff 命令同源逻辑：过滤已知抖动字段，返回 [路径, 旧值, 新值] 列表。
 * GUI 与 CLI 共用语义，保证「skill 说的差异」和「界面看到的差异」一致。
 */

/** 已知每次请求都会变化的噪声字段，不算差异 */
export const DIFF_NOISE = new Set(['signatureServer', 'traceSign']);

/**
 * 递归对比两个 JSON 值。
 * @returns {Array<[string, *, *]>} 差异列表 [字段路径, 旧值, 新值]
 */
export function diffJson(a, b, path = '', out = []) {
  if (a === b) return out;
  const pa = path || '$';
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    out.push([pa, a, b]);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push([pa, JSON.stringify(a).slice(0, 60), JSON.stringify(b).slice(0, 60)]);
    return out;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    if (DIFF_NOISE.has(k)) continue;
    if (!(k in a)) out.push([`${pa}.${k}`, '(无)', b[k]]);
    else if (!(k in b)) out.push([`${pa}.${k}`, a[k], '(无)']);
    else diffJson(a[k], b[k], `${pa}.${k}`, out);
  }
  return out;
}

/** 解析响应快照 body 为 JSON；失败返回 null */
export function parseSnapJson(snap) {
  if (!snap || !snap.body) return null;
  try { return JSON.parse(snap.body); } catch { return null; }
}

/** 把值压成适合表格/行内展示的短文本 */
export function fmtDiffValue(v, max = 60) {
  if (v === '(无)') return v;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > max ? s.slice(0, max) + '…' : s;
}
