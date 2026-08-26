/**
 * 集合树工具：集合 > 文件夹（可嵌套） > 请求
 * 以及导入导出格式转换（原生 ReqMock 格式 + Hoppscotch / Postman / OpenAPI / Insomnia / HAR 兼容）
 */
import { normalizeAuth } from './authUtil.js';
import { isOpenApi, fromOpenApi, isInsomnia, fromInsomnia, isHar, fromHar } from './importFormats.js';

function uuid() {
  return crypto.randomUUID();
}

export function newCollection(name = '新建集合') {
  return { id: uuid(), name, doc: '', headers: [], folders: [], requests: [] };
}

export function newFolder(name = '新建文件夹') {
  return { id: uuid(), name, doc: '', folders: [], requests: [] };
}

/** 规范化请求对象，补齐缺失字段（兼容旧数据） */
export function normalizeRequest(req) {
  return {
    id: req.id || uuid(),
    name: req.name || '',
    method: req.method || 'GET',
    url: req.url || '',
    params: req.params || [],
    headers: req.headers || [],
    bodyType: req.bodyType || 'none',
    body: req.body || '',
    formData: req.formData || [],
    graphql: req.graphql || { query: '', variables: '' },
    auth: normalizeAuth(req.auth),
    preScript: req.preScript || '',
    postScript: req.postScript || '',
    doc: req.doc || '',
    // 请求级发送设置
    proxy: req.proxy || '',
    timeoutMs: req.timeoutMs || 30000,
    followRedirects: req.followRedirects !== false,
    httpVersion: req.httpVersion || 'auto',
    sslVerify: req.sslVerify !== false,
    omitEmptyEq: !!req.omitEmptyEq,
    cookieJarMode: req.cookieJarMode || 'default',
    injectId: !!req.injectId,
    // 示例响应：[{id, name, status, contentType, headers, body, savedAt}]
    examples: req.examples || []
  };
}

/** 规范化集合/文件夹节点（递归，兼容旧版扁平结构） */
export function normalizeNode(node) {
  return {
    ...node,
    id: node.id || uuid(),
    name: node.name || '未命名',
    doc: node.doc || '',
    headers: node.headers || [],
    folders: (node.folders || []).map(normalizeNode),
    requests: (node.requests || []).map(normalizeRequest)
  };
}

// ---- 递归树操作 ----

/** 对树中 id 匹配的节点（集合或文件夹）执行 fn，返回新树 */
export function updateNode(nodes, targetId, fn) {
  return nodes.map((n) => {
    if (n.id === targetId) return fn(n);
    return { ...n, folders: updateNode(n.folders || [], targetId, fn) };
  });
}

/** 删除树中 id 匹配的文件夹节点 */
export function removeNode(nodes, targetId) {
  return nodes
    .filter((n) => n.id !== targetId)
    .map((n) => ({ ...n, folders: removeNode(n.folders || [], targetId) }));
}

/** 在整棵树中查找节点（集合或文件夹） */
export function findNode(nodes, targetId) {
  for (const n of nodes) {
    if (n.id === targetId) return n;
    const found = findNode(n.folders || [], targetId);
    if (found) return found;
  }
  return null;
}

/** 更新/替换树中已存在的请求（按请求 id），返回 {tree, found} */
export function upsertRequestById(collections, req) {
  let found = false;
  const walk = (node) => {
    const idx = (node.requests || []).findIndex((r) => r.id === req.id);
    let requests = node.requests || [];
    if (idx >= 0) {
      found = true;
      requests = requests.map((r, i) => (i === idx ? req : r));
    }
    return { ...node, requests, folders: (node.folders || []).map(walk) };
  };
  const tree = collections.map(walk);
  return { tree, found };
}

/** 从树中删除请求 */
export function removeRequestById(collections, reqId) {
  const walk = (node) => ({
    ...node,
    requests: (node.requests || []).filter((r) => r.id !== reqId),
    folders: (node.folders || []).map(walk)
  });
  return collections.map(walk);
}

/** 收集节点下（含子文件夹）所有请求数量 */
export function countRequests(node) {
  return (node.requests || []).length +
    (node.folders || []).reduce((sum, f) => sum + countRequests(f), 0);
}

/** 在整棵树中按 id 查找请求（脏标记对比 / 拖拽移动用） */
export function findRequestById(collections, reqId) {
  const walk = (node) => {
    const r = (node.requests || []).find((x) => x.id === reqId);
    if (r) return r;
    for (const f of node.folders || []) {
      const found = walk(f);
      if (found) return found;
    }
    return null;
  };
  for (const c of collections) {
    const found = walk(c);
    if (found) return found;
  }
  return null;
}

/**
 * 拖拽移动请求：从原位置摘除后插入目标集合/文件夹，可指定插入到某请求之前。
 * 目标节点不存在或请求未找到时返回原树。
 */
export function moveRequest(collections, reqId, targetNodeId, beforeReqId = null) {
  let moved = null;
  const strip = (node) => {
    let requests = node.requests || [];
    const idx = requests.findIndex((r) => r.id === reqId);
    if (idx >= 0) {
      moved = requests[idx];
      requests = requests.filter((r) => r.id !== reqId);
    }
    return { ...node, requests, folders: (node.folders || []).map(strip) };
  };
  const stripped = collections.map(strip);
  if (!moved || !findNode(stripped, targetNodeId)) return collections;
  const insert = (node) => {
    if (node.id !== targetNodeId) {
      return { ...node, folders: (node.folders || []).map(insert) };
    }
    const requests = [...(node.requests || [])];
    const bi = beforeReqId ? requests.findIndex((r) => r.id === beforeReqId) : -1;
    if (bi >= 0) requests.splice(bi, 0, moved);
    else requests.push(moved);
    return { ...node, requests };
  };
  return stripped.map(insert);
}

/**
 * 拖拽移动文件夹：从原位置摘除后插入目标集合/文件夹内，可指定插入到某文件夹之前。
 * 防止将文件夹移入自身子树。目标节点不存在或文件夹未找到时返回原树。
 */
export function moveFolder(collections, folderId, targetNodeId, beforeFolderId = null) {
  // 防止移入自身
  if (folderId === targetNodeId) return collections;
  // 检查 targetNodeId 是否是 folderId 的子孙
  const srcNode = findNode(collections, folderId);
  if (!srcNode) return collections;
  if (findNode(srcNode.folders || [], targetNodeId)) return collections;

  let moved = null;
  const strip = (node) => {
    let folders = node.folders || [];
    const idx = folders.findIndex((f) => f.id === folderId);
    if (idx >= 0) {
      moved = folders[idx];
      folders = folders.filter((f) => f.id !== folderId);
    } else {
      folders = folders.map(strip);
    }
    return { ...node, folders };
  };
  let stripped = collections.map(strip);
  // 顶层集合也可能是被摘除的对象（但集合不应被移动，此处仅处理文件夹）
  if (!moved) return collections;
  if (!findNode(stripped, targetNodeId)) return collections;

  const insert = (node) => {
    if (node.id !== targetNodeId) {
      return { ...node, folders: (node.folders || []).map(insert) };
    }
    const folders = [...(node.folders || [])];
    const bi = beforeFolderId ? folders.findIndex((f) => f.id === beforeFolderId) : -1;
    if (bi >= 0) folders.splice(bi, 0, moved);
    else folders.push(moved);
    return { ...node, folders };
  };
  return stripped.map(insert);
}

/**
 * 对同级请求重新排序：将请求移到同一父节点中另一请求的前面或后面。
 * position: 'before' | 'after'
 */
export function reorderRequest(collections, reqId, targetNodeId, anchorReqId, position = 'before') {
  if (reqId === anchorReqId) return collections;
  let moved = null;
  const strip = (node) => {
    let requests = node.requests || [];
    const idx = requests.findIndex((r) => r.id === reqId);
    if (idx >= 0) {
      moved = requests[idx];
      requests = requests.filter((r) => r.id !== reqId);
    }
    return { ...node, requests, folders: (node.folders || []).map(strip) };
  };
  const stripped = collections.map(strip);
  if (!moved || !findNode(stripped, targetNodeId)) return collections;
  const insert = (node) => {
    if (node.id !== targetNodeId) {
      return { ...node, folders: (node.folders || []).map(insert) };
    }
    const requests = [...(node.requests || [])];
    const ai = requests.findIndex((r) => r.id === anchorReqId);
    if (ai >= 0) {
      const insertAt = position === 'after' ? ai + 1 : ai;
      requests.splice(insertAt, 0, moved);
    } else {
      requests.push(moved);
    }
    return { ...node, requests };
  };
  return stripped.map(insert);
}

/**
 * 查找请求所属的集合（用于合并集合级 Headers）
 */
export function findOwnerCollection(collections, reqId) {
  const contains = (node) =>
    (node.requests || []).some((r) => r.id === reqId) ||
    (node.folders || []).some(contains);
  return collections.find(contains) || null;
}

/**
 * 查找请求在树中的路径（集合/文件夹名称列表），用于面包屑导航；未保存时返回 null
 */
export function findRequestPath(collections, reqId) {
  const walk = (node, path) => {
    const cur = [...path, node.name];
    if ((node.requests || []).some((r) => r.id === reqId)) return cur;
    for (const f of node.folders || []) {
      const found = walk(f, cur);
      if (found) return found;
    }
    return null;
  };
  for (const c of collections) {
    const found = walk(c, []);
    if (found) return found;
  }
  return null;
}

// ---- 导入导出 ----

/** 导出单个集合为原生格式 JSON 字符串 */
export function exportCollection(collection) {
  return JSON.stringify({ reqmock: true, version: 1, type: 'collection', collection }, null, 2);
}

/** 导出全部数据（集合 + 环境） */
export function exportWorkspace(collections, environments) {
  return JSON.stringify({ reqmock: true, version: 1, type: 'workspace', collections, environments }, null, 2);
}

/** 导出单个环境为原生格式 JSON 字符串 */
export function exportEnvironment(environment) {
  return JSON.stringify({ reqmock: true, version: 1, type: 'environment', environment }, null, 2);
}

/** 导出全部环境（含全局变量） */
export function exportEnvironments(environments, globals) {
  return JSON.stringify({ reqmock: true, version: 1, type: 'environments', environments: environments || [], globals: globals || [] }, null, 2);
}

/**
 * 解析导入内容，自动识别格式。
 * 返回 { collections: [], environments: [], globals?: [] }，无法识别时抛错。
 */
export function parseImport(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error('不是合法的 JSON 文件');
  }

  // 原生格式
  if (data && data.reqmock) {
    if (data.type === 'collection' && data.collection) {
      return { collections: [regenerateIds(normalizeNode(data.collection))], environments: [] };
    }
    if (data.type === 'workspace') {
      return {
        collections: (data.collections || []).map((c) => regenerateIds(normalizeNode(c))),
        environments: (data.environments || []).map((e) => ({ ...e, id: uuid() }))
      };
    }
    if (data.type === 'environment' && data.environment) {
      return { collections: [], environments: [{ ...data.environment, id: uuid() }] };
    }
    if (data.type === 'environments') {
      return {
        collections: [],
        environments: (data.environments || []).map((e) => ({ ...e, id: uuid() })),
        globals: (data.globals || []).filter((v) => v && v.key)
      };
    }
  }

  const list = Array.isArray(data) ? data : [data];
  // Reqable 环境格式（变量字段为 name，需先于 Hoppscotch 判断，否则会被误识为 key 字段导致变量名丢失）
  if (list.length > 0 && list.every(isReqableEnvironment)) {
    return { collections: [], environments: list.map(fromReqableEnvironment) };
  }
  // Hoppscotch 集合格式（单个对象或数组）
  if (list.length > 0 && list.every(isHoppCollection)) {
    return { collections: list.map(fromHoppCollection), environments: [] };
  }
  // Hoppscotch 环境格式
  if (list.length > 0 && list.every(isHoppEnvironment)) {
    return { collections: [], environments: list.map(fromHoppEnvironment) };
  }
  // Postman v2.x 集合格式
  if (list.length > 0 && list.every(isPostmanCollection)) {
    return { collections: list.map(fromPostmanCollection), environments: [] };
  }
  // Postman 环境格式
  if (list.length > 0 && list.every(isPostmanEnvironment)) {
    return { collections: [], environments: list.map(fromPostmanEnvironment) };
  }
  // Swagger / OpenAPI 文档
  if (isOpenApi(data)) {
    return { collections: [fromOpenApi(data)], environments: [] };
  }
  // Insomnia v4 导出
  if (isInsomnia(data)) {
    return fromInsomnia(data);
  }
  // HAR 抓包归档
  if (isHar(data)) {
    return { collections: [fromHar(data)], environments: [] };
  }

  throw new Error('无法识别的文件格式（支持 ReqMock / Reqable / Hoppscotch / Postman / OpenAPI / Insomnia / HAR 的 JSON）');
}

/** 导入时重新生成所有 id，避免与现有数据冲突 */
export function regenerateIds(node) {
  return {
    ...node,
    id: uuid(),
    requests: (node.requests || []).map((r) => ({ ...r, id: uuid() })),
    folders: (node.folders || []).map(regenerateIds)
  };
}

// ---- Reqable 格式转换 ----

/** Reqable 环境导出：info 标记 + variables 数组（元素用 name 而非 key） */
function isReqableEnvironment(o) {
  return o && typeof o === 'object' && typeof o.info === 'string' &&
    /reqable environment/i.test(o.info) && Array.isArray(o.variables);
}

function fromReqableEnvironment(e) {
  return {
    id: uuid(),
    name: e.name || '导入环境',
    variables: (e.variables || []).map((v) => ({
      key: v.name || v.key || '',
      value: v.value != null ? String(v.value) : '',
      enabled: v.enabled !== false
    }))
  };
}

// ---- Hoppscotch 格式转换 ----

function isHoppCollection(o) {
  return o && typeof o === 'object' && typeof o.name === 'string' &&
    Array.isArray(o.requests) && Array.isArray(o.folders) && !o.reqmock;
}

function isHoppEnvironment(o) {
  return o && typeof o === 'object' && typeof o.name === 'string' &&
    Array.isArray(o.variables) && !Array.isArray(o.requests);
}

function fromHoppCollection(hopp) {
  return {
    id: uuid(),
    name: hopp.name || '导入集合',
    doc: '',
    headers: (hopp.headers || []).map(fromHoppKv),
    folders: (hopp.folders || []).map(fromHoppCollection),
    requests: (hopp.requests || []).map(fromHoppRequest)
  };
}

function fromHoppRequest(r) {
  const body = r.body && typeof r.body === 'object' ? r.body : {};
  let bodyType = 'none';
  if (body.contentType) {
    if (String(body.contentType).includes('json')) bodyType = 'json';
    else if (String(body.contentType).includes('form')) bodyType = 'form';
    else bodyType = 'text';
  }
  return normalizeRequest({
    id: uuid(),
    name: r.name || r.endpoint || '导入请求',
    method: r.method || 'GET',
    url: r.endpoint || '',
    params: (r.params || []).map(fromHoppKv),
    headers: (r.headers || []).map(fromHoppKv),
    bodyType,
    body: typeof body.body === 'string' ? body.body : '',
    preScript: r.preRequestScript || '',
    postScript: r.testScript || '',
    doc: ''
  });
}

function fromHoppKv(kv) {
  return { key: kv.key || '', value: kv.value || '', enabled: kv.active !== false };
}

function fromHoppEnvironment(e) {
  return {
    id: uuid(),
    name: e.name || '导入环境',
    variables: (e.variables || []).map((v) => ({
      key: v.key || '',
      value: v.value != null ? String(v.value) : (v.initialValue != null ? String(v.initialValue) : ''),
      enabled: true
    }))
  };
}

// ---- Postman v2.x 格式转换 ----

function isPostmanCollection(o) {
  return o && typeof o === 'object' && o.info && typeof o.info === 'object' && Array.isArray(o.item);
}

function isPostmanEnvironment(o) {
  return o && typeof o === 'object' && typeof o.name === 'string' && Array.isArray(o.values) &&
    !Array.isArray(o.variables) && !Array.isArray(o.item);
}

function fromPostmanCollection(pm) {
  const { folders, requests } = fromPostmanItems(pm.item || []);
  return {
    id: uuid(),
    name: (pm.info && pm.info.name) || '导入集合',
    doc: typeof (pm.info && pm.info.description) === 'string' ? pm.info.description : '',
    headers: [],
    folders,
    requests
  };
}

/** item 含 item 数组视为文件夹，含 request 视为请求 */
function fromPostmanItems(items) {
  const folders = [];
  const requests = [];
  for (const it of items || []) {
    if (Array.isArray(it.item)) {
      const sub = fromPostmanItems(it.item);
      folders.push({
        id: uuid(),
        name: it.name || '导入文件夹',
        doc: '',
        folders: sub.folders,
        requests: sub.requests
      });
    } else if (it.request) {
      requests.push(fromPostmanRequest(it));
    }
  }
  return { folders, requests };
}

function fromPostmanRequest(item) {
  const r = typeof item.request === 'string' ? { url: item.request } : (item.request || {});
  const urlRaw = typeof r.url === 'string' ? r.url : ((r.url && r.url.raw) || '');
  const params = (r.url && Array.isArray(r.url.query) ? r.url.query : []).map((p) => ({
    key: p.key || '',
    value: p.value || '',
    enabled: p.disabled !== true
  }));

  let bodyType = 'none';
  let body = '';
  const pb = r.body || {};
  if (pb.mode === 'raw') {
    body = pb.raw || '';
    const lang = pb.options && pb.options.raw && pb.options.raw.language;
    bodyType = (lang === 'json' || /^\s*[[{]/.test(body)) ? 'json' : 'text';
  } else if (pb.mode === 'urlencoded' || pb.mode === 'formdata') {
    bodyType = 'form';
    body = (pb[pb.mode] || [])
      .filter((f) => f.disabled !== true && f.key && f.type !== 'file')
      .map((f) => `${f.key}=${f.value ?? ''}`)
      .join('&');
  }

  let preScript = '';
  let postScript = '';
  for (const ev of item.event || []) {
    const code = ev.script && Array.isArray(ev.script.exec) ? ev.script.exec.join('\n') : '';
    if (ev.listen === 'prerequest') preScript = code;
    if (ev.listen === 'test') postScript = code;
  }

  return normalizeRequest({
    id: uuid(),
    name: item.name || '导入请求',
    method: (r.method || 'GET').toUpperCase(),
    url: urlRaw,
    params,
    headers: (r.header || []).map((h) => ({
      key: h.key || '',
      value: h.value || '',
      enabled: h.disabled !== true
    })),
    bodyType,
    body,
    auth: fromPostmanAuth(r.auth),
    preScript,
    postScript,
    doc: typeof r.description === 'string' ? r.description : ''
  });
}

/** Postman auth 参数为 [{key,value}] 列表 */
function fromPostmanAuth(a) {
  if (!a || !a.type) return undefined;
  const get = (list, key) => {
    const found = (Array.isArray(list) ? list : []).find((x) => x && x.key === key);
    return found && found.value != null ? String(found.value) : '';
  };
  if (a.type === 'basic') {
    return { type: 'basic', username: get(a.basic, 'username'), password: get(a.basic, 'password') };
  }
  if (a.type === 'bearer') {
    return { type: 'bearer', token: get(a.bearer, 'token') };
  }
  if (a.type === 'apikey') {
    return {
      type: 'apikey',
      key: get(a.apikey, 'key'),
      value: get(a.apikey, 'value'),
      addTo: get(a.apikey, 'in') === 'query' ? 'query' : 'header'
    };
  }
  return undefined;
}

function fromPostmanEnvironment(e) {
  return {
    id: uuid(),
    name: e.name || '导入环境',
    variables: (e.values || []).map((v) => ({
      key: v.key || '',
      value: v.value != null ? String(v.value) : '',
      enabled: v.enabled !== false
    }))
  };
}

/**
 * 从 URL 提取显示名称：取路径最后一段（去掉 query）
 * 例：https://host/api/v1/columns?a=1 → "columns"
 *     http://host/api/1?appVersion=xxx → "1"
 *     空 URL → "未命名请求"
 */
export function nameFromUrl(url) {
  if (!url) return '未命名请求';
  try {
    // 去掉 query 和 hash
    const path = url.split('?')[0].split('#')[0];
    // 取最后一段非空路径
    const segments = path.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last || '未命名请求';
  } catch (e) { return '未命名请求'; }
}
