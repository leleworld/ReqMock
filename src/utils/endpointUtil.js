/**
 * 聚合模式（Endpoint Mode）工具
 *
 * 聚合键 = method + path（精确匹配，路径参数不归一：/orders/1 与 /orders/2 是两条接口）；
 * 域名与 query 不进键——它们是「变体」维度：同 path 的不同 host + 参数组合归在同一接口下。
 * 存储层完全不动（仍是平铺 requests），聚合是纯派生的视图层概念。
 */

/** 去掉 query/fragment，返回 { host, path }。host 可能是 {{baseUrl}} 这类未解析变量 */
function splitUrl(url) {
  let s = String(url || '').trim();
  if (!s) return { host: '', path: '' };
  // 去 fragment 与 query
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(0, hash);
  const q = s.indexOf('?');
  const query = q >= 0 ? s.slice(q + 1) : '';
  if (q >= 0) s = s.slice(0, q);
  // scheme://host/path → host / path
  const m = s.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/\s]*)(\/.*)?$/);
  if (m) return { host: m[1], path: m[2] || '/' };
  // 无 scheme：首段可能是 {{var}} 或裸 host，其余视为 path
  const slash = s.indexOf('/');
  if (slash > 0) return { host: s.slice(0, slash), path: s.slice(slash) };
  return { host: '', path: s };
}

/** host 短名：域名取首段；IP 形态保留完整；{{var}} 去花括号 */
function hostShortOf(host) {
  const bare = String(host || '').replace(/^\{\{/, '').replace(/\}\}$/, '');
  if (!bare) return '未命名';
  if (/^[\d.]+$/.test(bare)) return bare;
  return bare.split('.')[0] || bare;
}

/** 聚合键：method + path（path 精确匹配；末尾多余斜杠归一） */
export function uriKey(item) {
  if (!item) return '';
  const method = (item.method || 'GET').toUpperCase();
  let { path } = splitUrl(item.url);
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');
  return `${method} ${path}`;
}

/** 变体展示名：优先用户命名 variantName，否则 host 短名 + query 摘要 */
export function variantLabel(req) {
  if (!req) return '';
  if (req.variantName) return req.variantName;
  const { host, path } = splitUrl(req.url);
  let q = '';
  const raw = String(req.url || '');
  const qi = raw.indexOf('?');
  if (qi >= 0) q = raw.slice(qi);
  const hostShort = hostShortOf(host);
  const base = path === '/' ? hostShort : hostShort + (q ? '' : path);
  return base + (q && q !== '?' ? q.slice(0, 24) : '');
}

/** 解析 URL query 为 [key, value] 对（保留重复键，decode 后比较） */
function parseQueryPairs(url) {
  const raw = String(url || '');
  const i = raw.indexOf('?');
  if (i < 0) return [];
  return raw.slice(i + 1)
    .split('&')
    .filter(Boolean)
    .map((seg) => {
      const eq = seg.indexOf('=');
      const k = eq < 0 ? seg : seg.slice(0, eq);
      const v = eq < 0 ? '' : seg.slice(eq + 1);
      let dk = k, dv = v;
      try { dk = decodeURIComponent(k); } catch (e) { /* 保留原样 */ }
      try { dv = decodeURIComponent(v); } catch (e) { /* 保留原样 */ }
      return [dk, dv];
    });
}

/**
 * 变体标签优先级：用户命名 variantName > 请求名称 name > host 短名 + 参数差异。
 * 参数差异 = 仅保留与组内其他变体【不同】的参数（同 key 同值的公共参数省略）；
 * 单变体组退化为完整 host+query。悬浮提示里始终有差异标签与完整 URL。
 */
export function variantDiffLabel(req, siblings = []) {
  if (!req) return '';
  if (req.variantName) return req.variantName;
  if (req.name) return req.name;
  const others = (siblings || []).filter((x) => x && x.id !== req.id);
  const { host, path } = splitUrl(req.url);
  const hostShort = hostShortOf(host);
  if (others.length === 0) return variantLabel(req);
  // 其他变体的 query 键值（重复键取首个）
  const otherMaps = others.map((o) => {
    const m = new Map();
    for (const [k, v] of parseQueryPairs(o.url)) if (!m.has(k)) m.set(k, v);
    return m;
  });
  const diffs = [];
  const seen = new Set();
  for (const [k, v] of parseQueryPairs(req.url)) {
    if (seen.has(k)) continue;
    seen.add(k);
    const allSame = otherMaps.every((m) => m.has(k) && m.get(k) === v);
    if (!allSame) diffs.push(k + '=' + v);
  }
  if (diffs.length === 0) return hostShort + '（参数同）';
  return hostShort + '?' + diffs.join('&');
}

/**
 * 把一个集合/文件夹节点下的【直接】请求按聚合键分组（不递归子文件夹，
 * 层级由视图层保留：每个文件夹各自聚合各自请求）。
 * 返回 [{ key, method, path, variants: [req...] }]，变体保持出现顺序，组间按首次出现顺序。
 */
export function aggregateNode(node) {
  const map = new Map();
  for (const r of node.requests || []) {
    const key = uriKey(r);
    if (!key || key === 'GET ') continue;
    if (!map.has(key)) {
      const { path } = splitUrl(r.url);
      map.set(key, { key, method: (r.method || 'GET').toUpperCase(), path, variants: [] });
    }
    map.get(key).variants.push(r);
  }
  return Array.from(map.values());
}

/** 在树中查找与目标请求同键的其他请求（返回同组全部成员，含自身；找不到返回 null） */
export function findVariantGroup(collections, req) {
  if (!req) return null;
  const key = uriKey(req);
  let found = null;
  const walk = (n) => {
    if (found) return;
    const members = (n.requests || []).filter((r) => uriKey(r) === key);
    if (members.length > 0) { found = { node: n, key, members }; return; }
    for (const f of n.folders || []) walk(f);
  };
  for (const c of collections || []) walk(c);
  return found;
}

/** 在树中查找包含同键成员的节点（供自动落变体：不含自身也在内） */
export function findGroupNodeForKey(collections, req) {
  const g = findVariantGroup(collections, req);
  return g ? g.node : null;
}
