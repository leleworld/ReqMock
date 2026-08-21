/**
 * 第三方格式导入：Swagger/OpenAPI (JSON) / Insomnia v4 / HAR
 * 每个格式提供 isXxx 检测 + fromXxx 转换，由 collectionUtil.parseImport 调度
 */
import { normalizeRequest } from './collectionUtil.js';

function uuid() {
  return crypto.randomUUID();
}

// ---- Swagger / OpenAPI ----

export function isOpenApi(o) {
  return o && typeof o === 'object' && !!(o.openapi || o.swagger) && o.paths && typeof o.paths === 'object';
}

export function fromOpenApi(doc) {
  const baseUrl = getOpenApiBaseUrl(doc);
  const info = doc.info || {};
  // 按首个 tag 分组到文件夹
  const folderMap = new Map();
  const rootRequests = [];

  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      const req = fromOpenApiOperation(doc, baseUrl, pathKey, method, op, pathItem);
      const tag = Array.isArray(op.tags) && op.tags[0] ? String(op.tags[0]) : '';
      if (tag) {
        if (!folderMap.has(tag)) {
          folderMap.set(tag, { id: uuid(), name: tag, doc: '', folders: [], requests: [] });
        }
        folderMap.get(tag).requests.push(req);
      } else {
        rootRequests.push(req);
      }
    }
  }

  return {
    id: uuid(),
    name: info.title || 'OpenAPI 导入',
    doc: info.description || '',
    headers: [],
    folders: [...folderMap.values()],
    requests: rootRequests
  };
}

function getOpenApiBaseUrl(doc) {
  // OpenAPI 3.x
  if (Array.isArray(doc.servers) && doc.servers[0] && doc.servers[0].url) {
    return String(doc.servers[0].url).replace(/\/$/, '');
  }
  // Swagger 2.0
  if (doc.host) {
    const scheme = Array.isArray(doc.schemes) && doc.schemes[0] ? doc.schemes[0] : 'https';
    return `${scheme}://${doc.host}${(doc.basePath || '').replace(/\/$/, '')}`;
  }
  return '';
}

function fromOpenApiOperation(doc, baseUrl, pathKey, method, op, pathItem) {
  // 路径模板 {id} → {{id}} 变量形式
  const urlPath = pathKey.replace(/\{([^}]+)\}/g, '{{$1}}');
  const allParams = [...(pathItem.parameters || []), ...(op.parameters || [])];
  const params = allParams
    .filter((p) => p && p.in === 'query')
    .map((p) => ({ key: p.name || '', value: exampleValue(p), enabled: p.required === true }));
  const headers = allParams
    .filter((p) => p && p.in === 'header')
    .map((p) => ({ key: p.name || '', value: exampleValue(p), enabled: p.required === true }));

  let bodyType = 'none';
  let body = '';
  // OpenAPI 3.x requestBody
  const rb = op.requestBody;
  const content = rb && rb.content;
  if (content && typeof content === 'object') {
    const ct = Object.keys(content).find((k) => k.includes('json')) || Object.keys(content)[0];
    if (ct) {
      const media = content[ct] || {};
      const sample = media.example !== undefined
        ? media.example
        : schemaToSample(resolveRef(doc, media.schema), doc, 0);
      if (sample !== undefined) {
        if (ct.includes('json')) {
          bodyType = 'json';
          body = JSON.stringify(sample, null, 2);
        } else if (ct.includes('form')) {
          bodyType = 'form';
          body = typeof sample === 'object' && sample
            ? Object.entries(sample).map(([k, v]) => `${k}=${v ?? ''}`).join('&')
            : '';
        } else {
          bodyType = 'text';
          body = typeof sample === 'string' ? sample : JSON.stringify(sample);
        }
      }
    }
  }
  // Swagger 2.0 body 参数
  const bodyParam = allParams.find((p) => p && p.in === 'body');
  if (bodyParam && bodyType === 'none') {
    const sample = schemaToSample(resolveRef(doc, bodyParam.schema), doc, 0);
    if (sample !== undefined) {
      bodyType = 'json';
      body = JSON.stringify(sample, null, 2);
    }
  }

  return normalizeRequest({
    id: uuid(),
    name: op.summary || op.operationId || `${method.toUpperCase()} ${pathKey}`,
    method: method.toUpperCase(),
    url: baseUrl + urlPath,
    params,
    headers,
    bodyType,
    body,
    doc: op.description || ''
  });
}

function exampleValue(p) {
  if (p.example !== undefined) return String(p.example);
  const schema = p.schema || p;
  if (schema.default !== undefined) return String(schema.default);
  if (schema.example !== undefined) return String(schema.example);
  return '';
}

/** 解析 $ref 引用（#/components/schemas/Xxx 或 #/definitions/Xxx） */
function resolveRef(doc, schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 10) return schema;
  if (schema.$ref && typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    let cur = doc;
    for (const seg of schema.$ref.slice(2).split('/')) {
      cur = cur && cur[seg];
    }
    return resolveRef(doc, cur, depth + 1);
  }
  return schema;
}

/** 由 JSON Schema 生成示例数据（简化版） */
function schemaToSample(schema, doc, depth) {
  if (!schema || typeof schema !== 'object' || depth > 6) return undefined;
  schema = resolveRef(doc, schema);
  if (!schema || typeof schema !== 'object') return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  const type = schema.type || (schema.properties ? 'object' : undefined);
  if (type === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      const val = schemaToSample(v, doc, depth + 1);
      out[k] = val === undefined ? null : val;
    }
    return out;
  }
  if (type === 'array') {
    const item = schemaToSample(schema.items, doc, depth + 1);
    return item === undefined ? [] : [item];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return true;
  if (type === 'string') return schema.format === 'date-time' ? '2024-01-01T00:00:00Z' : 'string';
  return undefined;
}

// ---- Insomnia v4 导出格式 ----

export function isInsomnia(o) {
  return o && typeof o === 'object' && o._type === 'export' && Array.isArray(o.resources);
}

export function fromInsomnia(data) {
  const resources = data.resources || [];
  const requests = resources.filter((r) => r._type === 'request');
  const groups = resources.filter((r) => r._type === 'request_group');
  const workspaces = resources.filter((r) => r._type === 'workspace');
  const envResources = resources.filter((r) => r._type === 'environment');

  // 以 workspace 为集合根；folder 树按 parentId 组装
  const nodeById = new Map();
  for (const g of groups) {
    nodeById.set(g._id, { id: uuid(), name: g.name || '导入文件夹', doc: '', folders: [], requests: [] });
  }
  const collections = workspaces.map((w) => ({
    id: uuid(),
    name: w.name || 'Insomnia 导入',
    doc: w.description || '',
    headers: [],
    folders: [],
    requests: [],
    _insomniaId: w._id
  }));
  const fallback = { id: uuid(), name: 'Insomnia 导入', doc: '', headers: [], folders: [], requests: [], _insomniaId: null };

  const attach = (parentId) => {
    if (nodeById.has(parentId)) return nodeById.get(parentId);
    const col = collections.find((c) => c._insomniaId === parentId);
    return col || fallback;
  };
  for (const g of groups) {
    attach(g.parentId).folders.push(nodeById.get(g._id));
  }
  for (const r of requests) {
    attach(r.parentId).requests.push(fromInsomniaRequest(r));
  }

  const outCols = collections.filter((c) => c.folders.length || c.requests.length);
  if (fallback.folders.length || fallback.requests.length) outCols.push(fallback);
  for (const c of outCols) delete c._insomniaId;

  const environments = envResources
    .filter((e) => e.data && typeof e.data === 'object' && Object.keys(e.data).length)
    .map((e) => ({
      id: uuid(),
      name: e.name || '导入环境',
      variables: Object.entries(e.data).map(([k, v]) => ({
        key: k, value: v != null && typeof v !== 'object' ? String(v) : JSON.stringify(v), enabled: true
      }))
    }));

  return { collections: outCols, environments };
}

function fromInsomniaRequest(r) {
  const mime = (r.body && r.body.mimeType) || '';
  let bodyType = 'none';
  let body = '';
  if (r.body && typeof r.body.text === 'string' && r.body.text) {
    body = r.body.text;
    bodyType = mime.includes('json') ? 'json' : mime.includes('form') ? 'form' : 'text';
  } else if (r.body && Array.isArray(r.body.params) && r.body.params.length) {
    bodyType = 'form';
    body = r.body.params
      .filter((p) => p.name)
      .map((p) => `${p.name}=${p.value ?? ''}`)
      .join('&');
  }

  let auth;
  const a = r.authentication || {};
  if (a.type === 'basic') auth = { type: 'basic', username: a.username || '', password: a.password || '' };
  else if (a.type === 'bearer') auth = { type: 'bearer', token: a.token || '' };
  else if (a.type === 'apikey') auth = { type: 'apikey', key: a.key || '', value: a.value || '', addTo: a.addTo === 'queryParams' ? 'query' : 'header' };

  return normalizeRequest({
    id: uuid(),
    name: r.name || '导入请求',
    method: (r.method || 'GET').toUpperCase(),
    // Insomnia 变量语法 {{ _.var }} → {{var}}
    url: String(r.url || '').replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, '{{$1}}'),
    params: (r.parameters || []).map((p) => ({ key: p.name || '', value: p.value || '', enabled: p.disabled !== true })),
    headers: (r.headers || []).map((h) => ({ key: h.name || '', value: h.value || '', enabled: h.disabled !== true })),
    bodyType,
    body,
    auth,
    doc: r.description || ''
  });
}

// ---- HAR（HTTP Archive）----

/** 需要跳过的静态资源扩展名 */
const HAR_STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map|webp|avif|mp4|webm|mp3)(\?|$)/i;

/** 判断是否为需要跳过的静态资源 */
function isStaticResource(url) {
  try {
    const pathname = new URL(url).pathname;
    return HAR_STATIC_EXTENSIONS.test(pathname);
  } catch (e) {
    return HAR_STATIC_EXTENSIONS.test(url);
  }
}

/** 判断 entry 是否应该被保留（XHR/Fetch 过滤 + 静态资源过滤） */
function shouldKeepEntry(entry) {
  const url = entry.request && entry.request.url;
  if (!url) return false;
  // 过滤静态资源
  if (isStaticResource(url)) return false;
  // 如果有 _resourceType 字段，只保留 xhr/fetch
  if (entry._resourceType) {
    const rt = entry._resourceType.toLowerCase();
    return rt === 'xhr' || rt === 'fetch';
  }
  // 没有 _resourceType 字段时全部保留
  return true;
}

export function isHar(o) {
  return o && typeof o === 'object' && o.log && o.log.entries && Array.isArray(o.log.entries);
}

export function parseHar(data) {
  const requests = (data.log.entries || [])
    .filter((e) => e && e.request && e.request.url && shouldKeepEntry(e))
    .map((e) => fromHarEntry(e));
  return {
    id: uuid(),
    name: 'HAR Import',
    doc: `Imported ${requests.length} requests from HAR file`,
    headers: [],
    folders: [],
    requests
  };
}

/** 保留旧名称作为别名，兼容已有调用 */
export const fromHar = parseHar;

/** HAR 中的伪 Header（:method: 等）与自动生成头不导入 */
const HAR_SKIP_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding']);

function fromHarEntry(entry) {
  const r = entry.request;
  let name = r.url;
  try {
    name = new URL(r.url).pathname || r.url;
  } catch (e) { /* 保留原 URL */ }

  let bodyType = 'none';
  let body = '';
  const pd = r.postData;
  // 从 queryString 提取 params
  const params = (r.queryString || [])
    .map((q) => ({ key: q.name || '', value: q.value || '', enabled: true }));
  if (pd && typeof pd.text === 'string' && pd.text) {
    body = pd.text;
    const mime = pd.mimeType || '';
    bodyType = mime.includes('json')
      ? 'json'
      : mime.includes('x-www-form-urlencoded')
        ? 'form'
        : mime.includes('multipart')
          ? 'multipart'
          : 'text';
  } else if (pd && Array.isArray(pd.params) && pd.params.length) {
    // multipart form-data 以 params 数组形式存在
    bodyType = (pd.mimeType || '').includes('multipart') ? 'multipart' : 'form';
    body = pd.params
      .filter((p) => p.name)
      .map((p) => `${p.name}=${p.value ?? ''}`)
      .join('&');
  }

  return normalizeRequest({
    id: uuid(),
    name: `${r.method} ${name}`,
    method: (r.method || 'GET').toUpperCase(),
    url: r.url,
    headers: (r.headers || [])
      .filter((h) => h.name && !h.name.startsWith(':') && !HAR_SKIP_HEADERS.has(h.name.toLowerCase()))
      .map((h) => ({ key: h.name, value: h.value || '', enabled: true })),
    params,
    bodyType,
    body
  });
}
