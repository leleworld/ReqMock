/**
 * URL query / form body 与键值表格的双向同步工具
 */

/** 容错解码（非法转义序列时返回原文） */
function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, '%20'));
  } catch (e) {
    return s;
  }
}

/** 宽松编码：仅转义会破坏 query 结构的字符，保留 {{var}} 等可读性 */
function lightEncode(s) {
  return String(s ?? '').replace(/[&=#+\s]/g, (c) => encodeURIComponent(c === ' ' ? ' ' : c));
}

/** 拆分 URL 为 base 与 query 字符串（不要求 URL 完整合法） */
export function splitUrl(url) {
  const idx = (url || '').indexOf('?');
  if (idx < 0) return { base: url || '', query: '' };
  return { base: url.slice(0, idx), query: url.slice(idx + 1) };
}

/** 把 query 字符串解析为键值行 [{key, value, enabled:true}] */
export function parseQuery(query) {
  if (!query) return [];
  return query.split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return { key: safeDecode(pair), value: '', enabled: true };
    return { key: safeDecode(pair.slice(0, eq)), value: safeDecode(pair.slice(eq + 1)), enabled: true };
  });
}

/**
 * URL 变化 → 同步 Params 表：
 * 解析 URL 中的 query 生成启用行，并保留原表格中被禁用的行
 */
export function syncParamsFromUrl(url, prevParams) {
  const { query } = splitUrl(url);
  const parsed = parseQuery(query);
  const disabled = (prevParams || []).filter((p) => p.enabled === false);
  return [...parsed, ...disabled];
}

/**
 * Params 表变化 → 回写 URL：
 * 用启用且 key 非空的行重建 URL 的 query 部分
 */
export function buildUrlFromParams(url, params) {
  const { base } = splitUrl(url);
  const pairs = (params || [])
    .filter((p) => p.enabled !== false && p.key)
    .map((p) => `${lightEncode(p.key)}=${lightEncode(p.value)}`);
  return pairs.length ? `${base}?${pairs.join('&')}` : base;
}

/** form body 字符串（a=1&b=2）解析为键值行 */
export function parseFormBody(body) {
  return parseQuery((body || '').trim());
}

/** 键值行序列化为 form body 字符串（禁用行不写入） */
export function buildFormBody(rows) {
  return (rows || [])
    .filter((r) => r.enabled !== false && r.key)
    .map((r) => `${lightEncode(r.key)}=${lightEncode(r.value)}`)
    .join('&');
}

/**
 * 打开请求时的一次性同步：
 * URL 带 query 而 Params 表为空时，自动解析加载
 */
export function normalizeOpenedRequest(req) {
  const params = req.params || [];
  const { query } = splitUrl(req.url || '');
  if (query && params.length === 0) {
    return { ...req, params: parseQuery(query) };
  }
  return { ...req, params, headers: req.headers || [] };
}
