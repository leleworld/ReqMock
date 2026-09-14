/**
 * 请求改动（Change Delta）：两次发送之间「到底改了什么」
 *
 * 为什么需要它：同一个接口会被反复发很多次，每次通常只动一两个值。
 * 人不会记得上一条改了什么，所以这件事必须由工具算出来，而不是靠回忆。
 * 把两次请求快照压成可比较的 key-value 映射再求差，结果直接喂给「历史」页签，
 * 也可以被后续的时序对比 / 回归复用。
 *
 * 映射规则与 httpClient 的拼接顺序保持一致：
 *   url 自带的 query 先入表 → Params 表覆盖同名键（发送前会先删掉 url 上的同名 query）。
 * 为避免与真实参数名撞车，非参数维度用前缀：
 *   #url.host / #url.path / #url.body / #url.bodyType，请求头统一带 @ 前缀。
 */

/** 非参数维度的键（前缀避开真实参数名） */
export const DIM_HOST = '#url.host';
export const DIM_PATH = '#url.path';
export const DIM_BODY = '#url.body';
export const DIM_BODY_TYPE = '#url.bodyType';

/** 合成维度的展示名。
 *  ⚠️ 只给「不是请求参数」的维度起名：params 表里的 key 一律原样展示。
 *  接口参数名（appVersion / otaVersion / baseMedia…）是开发者在代码和文档里真正要搜的东西，
 *  翻译成「固件版本」反而多一层心智映射，定位问题时还得反查是哪个字段。 */
const DIM_LABELS = {
  [DIM_HOST]: '域名',
  [DIM_PATH]: '路径',
  [DIM_BODY]: '请求体',
  [DIM_BODY_TYPE]: '请求体类型'
};

/**
 * 展示名：
 * - 请求头 → `请求头 Xxx`（`@` 前缀只用于内部防撞名，展示时换成位置说明，避免和同名参数混淆）
 * - 域名/路径/请求体类型/请求体 → DIM_LABELS
 * - 其余（真正的请求参数）→ 原样返回 key
 */
export function changeLabel(key) {
  const k = String(key || '');
  if (k.startsWith('@')) return `请求头 ${k.slice(1)}`;
  return DIM_LABELS[k] || k;
}

/** 超长值折叠为「头…尾」，保证一行里能同时看到改前的值和改后的值 */
export function shortenValue(value, max = 24) {
  const s = String(value == null ? '' : value);
  if (s.length <= max) return s;
  const tail = Math.min(6, max - 2);
  return `${s.slice(0, max - tail - 1)}…${s.slice(-tail)}`;
}

/** 去掉 fragment 与 query，返回 { host, path, query }（host 可能是 {{baseUrl}} 这类未解析变量） */
function splitUrl(url) {
  let s = String(url || '').trim();
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(0, hash);
  const q = s.indexOf('?');
  const query = q >= 0 ? s.slice(q + 1) : '';
  if (q >= 0) s = s.slice(0, q);
  const m = s.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/\s]*)(\/.*)?$/);
  if (m) return { host: m[1] || '', path: m[2] || '/', query };
  const slash = s.indexOf('/');
  if (slash > 0) return { host: s.slice(0, slash), path: s.slice(slash), query };
  return { host: '', path: slash === 0 ? s : s, query };
}

/** 解析 query 串为 [key, value]（decode 后比较，解码失败保留原样） */
function parseQuery(query) {
  return String(query || '')
    .split('&')
    .filter(Boolean)
    .map((seg) => {
      const eq = seg.indexOf('=');
      const rawKey = eq < 0 ? seg : seg.slice(0, eq);
      const rawVal = eq < 0 ? '' : seg.slice(eq + 1);
      let key = rawKey;
      let val = rawVal;
      try { key = decodeURIComponent(rawKey); } catch (e) { /* 保留原样 */ }
      try { val = decodeURIComponent(rawVal); } catch (e) { /* 保留原样 */ }
      return [key, val];
    });
}

/**
 * 把一条请求快照压成可比较的映射。
 * 快照来源：发送时写入 history 的条目（含 url / params / headers / body / bodyType）。
 */
export function requestParamMap(item) {
  const map = {};
  if (!item) return map;

  const { host, path, query } = splitUrl(item.url);
  if (host) map[DIM_HOST] = host;
  if (path) map[DIM_PATH] = path;
  parseQuery(query).forEach(([k, v]) => { if (k) map[k] = v; });

  // Params 表优先：与发送前「先删同名 query 再 append」的行为一致
  for (const p of item.params || []) {
    if (!p || !p.key) continue;
    if (p.enabled === false) continue;
    map[p.key] = p.value == null ? '' : String(p.value);
  }

  for (const h of item.headers || []) {
    if (!h || !h.key) continue;
    if (h.enabled === false) continue;
    map[`@${h.key}`] = h.value == null ? '' : String(h.value);
  }

  const bodyType = item.bodyType || 'none';
  const body = typeof item.body === 'string' ? item.body : '';
  if (bodyType !== 'none' || body) {
    map[DIM_BODY_TYPE] = bodyType;
    map[DIM_BODY] = body;
  }

  return map;
}

/** 键的展示排序：域名/路径 → 参数 → 请求头 → 请求体 */
function keyRank(key) {
  if (key === DIM_HOST) return 0;
  if (key === DIM_PATH) return 1;
  if (key === DIM_BODY_TYPE) return 8;
  if (key === DIM_BODY) return 9;
  if (key.startsWith('@')) return 7;
  return 5;
}

/**
 * 比较两个映射，返回改动列表
 * @returns {Array<{key, prev, next, kind}>} kind: 'add' | 'del' | 'mod'
 */
export function diffParamMaps(prevMap, nextMap) {
  const a = prevMap || {};
  const b = nextMap || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  keys.forEach((k) => {
    const before = a[k];
    const after = b[k];
    const beforeStr = String(before == null ? '' : before);
    const afterStr = String(after == null ? '' : after);
    if (before === undefined) {
      out.push({ key: k, prev: '', next: afterStr, kind: 'add' });
    } else if (after === undefined) {
      out.push({ key: k, prev: beforeStr, next: '', kind: 'del' });
    } else if (beforeStr !== afterStr) {
      out.push({ key: k, prev: beforeStr, next: afterStr, kind: 'mod' });
    }
  });
  return out.sort((x, y) => keyRank(x.key) - keyRank(y.key));
}

/**
 * 比较两条发送记录，返回改动列表与本次映射
 * @param {object} prevItem 时间上更早的一条
 * @param {object} nextItem 本次
 */
export function diffRequests(prevItem, nextItem) {
  const prevMap = requestParamMap(prevItem);
  const nextMap = requestParamMap(nextItem);
  return { changes: diffParamMaps(prevMap, nextMap), map: nextMap };
}

/**
 * 把一条改动转成可直接渲染的展示数据（值已折叠，键名保持原样）
 * @param {object} change diffParamMaps 的元素
 * @param {{max?: number}} opts
 */
export function describeChange(change, opts = {}) {
  const max = opts.max || 24;
  const c = change || {};
  const empty = c.kind === 'add' ? '（新增）' : c.kind === 'del' ? '（移除）' : '（空值）';
  return {
    key: c.key,
    label: changeLabel(c.key),
    from: c.prev ? shortenValue(c.prev, max) : empty,
    to: c.next ? shortenValue(c.next, max) : empty,
    kind: c.kind
  };
}
