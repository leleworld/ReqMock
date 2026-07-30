/**
 * 集合导出扩展：Postman v2.1 格式 + Markdown 接口文档
 */
import { buildFullUrl } from './codegenUtil.js';

// ---- Postman v2.1 导出 ----

export function exportPostmanCollection(collection) {
  return JSON.stringify({
    info: {
      name: collection.name,
      description: collection.doc || '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: toPostmanItems(collection)
  }, null, 2);
}

function toPostmanItems(node) {
  const items = [];
  for (const f of node.folders || []) {
    items.push({ name: f.name, item: toPostmanItems(f) });
  }
  for (const r of node.requests || []) {
    items.push(toPostmanItem(r));
  }
  return items;
}

function toPostmanItem(req) {
  const item = {
    name: req.name || '未命名请求',
    request: {
      method: req.method || 'GET',
      header: (req.headers || []).filter((h) => h.key).map((h) => ({
        key: h.key, value: h.value ?? '', disabled: h.enabled === false
      })),
      url: toPostmanUrl(req)
    }
  };
  if (req.doc) item.request.description = req.doc;

  if (req.bodyType === 'json' || req.bodyType === 'text') {
    item.request.body = {
      mode: 'raw',
      raw: req.body || '',
      options: { raw: { language: req.bodyType === 'json' ? 'json' : 'text' } }
    };
  } else if (req.bodyType === 'form') {
    item.request.body = {
      mode: 'urlencoded',
      urlencoded: (req.formData || []).filter((f) => f.key).map((f) => ({
        key: f.key, value: f.value ?? '', disabled: f.enabled === false
      }))
    };
  } else if (req.bodyType === 'multipart') {
    item.request.body = {
      mode: 'formdata',
      formdata: (req.formData || []).filter((f) => f.key).map((f) => (
        f.type === 'file'
          ? { key: f.key, type: 'file', src: f.filePath || '' }
          : { key: f.key, value: f.value ?? '', type: 'text', disabled: f.enabled === false }
      ))
    };
  }

  const auth = req.auth;
  if (auth && auth.type !== 'none') {
    if (auth.type === 'basic') {
      item.request.auth = { type: 'basic', basic: [
        { key: 'username', value: auth.username || '', type: 'string' },
        { key: 'password', value: auth.password || '', type: 'string' }
      ] };
    } else if (auth.type === 'bearer') {
      item.request.auth = { type: 'bearer', bearer: [{ key: 'token', value: auth.token || '', type: 'string' }] };
    } else if (auth.type === 'apikey') {
      item.request.auth = { type: 'apikey', apikey: [
        { key: 'key', value: auth.key || '', type: 'string' },
        { key: 'value', value: auth.value || '', type: 'string' },
        { key: 'in', value: auth.addTo === 'query' ? 'query' : 'header', type: 'string' }
      ] };
    }
  }

  const events = [];
  if (req.preScript) events.push({ listen: 'prerequest', script: { exec: req.preScript.split('\n'), type: 'text/javascript' } });
  if (req.postScript) events.push({ listen: 'test', script: { exec: req.postScript.split('\n'), type: 'text/javascript' } });
  if (events.length) item.event = events;
  return item;
}

function toPostmanUrl(req) {
  const raw = req.url || '';
  const url = { raw };
  try {
    const u = new URL(raw);
    url.protocol = u.protocol.replace(':', '');
    url.host = u.hostname.split('.');
    if (u.port) url.port = u.port;
    url.path = u.pathname.split('/').filter(Boolean);
  } catch (e) { /* 非标准 URL（含变量等）仅保留 raw */ }
  const query = (req.params || []).filter((p) => p.key).map((p) => ({
    key: p.key, value: p.value ?? '', disabled: p.enabled === false
  }));
  if (query.length) url.query = query;
  return url;
}

// ---- Markdown 接口文档导出 ----

export function exportMarkdownDocs(collection) {
  const lines = [`# ${collection.name}`, ''];
  if (collection.doc) lines.push(collection.doc, '');
  if ((collection.headers || []).some((h) => h.key)) {
    lines.push('## 公共 Headers', '');
    lines.push('| Header | 值 |', '| --- | --- |');
    for (const h of collection.headers.filter((x) => x.key)) {
      lines.push(`| ${esc(h.key)} | ${esc(h.value)} |`);
    }
    lines.push('');
  }
  walkDocs(collection, lines, 2, '');
  return lines.join('\n');
}

function walkDocs(node, lines, level, prefix) {
  for (const r of node.requests || []) {
    requestDoc(r, lines, level);
  }
  for (const f of node.folders || []) {
    lines.push(`${'#'.repeat(Math.min(level, 6))} 📁 ${prefix}${f.name}`, '');
    if (f.doc) lines.push(f.doc, '');
    walkDocs(f, lines, level + 1, '');
  }
}

function requestDoc(req, lines, level) {
  lines.push(`${'#'.repeat(Math.min(level, 6))} ${req.name || '未命名请求'}`, '');
  lines.push('```', `${req.method} ${buildFullUrl(req) || req.url || ''}`, '```', '');
  if (req.doc) lines.push(req.doc, '');

  const params = (req.params || []).filter((p) => p.key);
  if (params.length) {
    lines.push('**Query 参数**', '', '| 参数 | 值 | 启用 |', '| --- | --- | --- |');
    for (const p of params) lines.push(`| ${esc(p.key)} | ${esc(p.value)} | ${p.enabled === false ? '否' : '是'} |`);
    lines.push('');
  }
  const headers = (req.headers || []).filter((h) => h.key);
  if (headers.length) {
    lines.push('**Headers**', '', '| Header | 值 |', '| --- | --- |');
    for (const h of headers) lines.push(`| ${esc(h.key)} | ${esc(h.value)} |`);
    lines.push('');
  }
  if (req.auth && req.auth.type !== 'none') {
    const label = { basic: 'Basic Auth', bearer: 'Bearer Token', apikey: 'API Key' }[req.auth.type] || req.auth.type;
    lines.push(`**授权**：${label}`, '');
  }
  if (req.bodyType && req.bodyType !== 'none' && req.body) {
    lines.push(`**Body**（${req.bodyType}）`, '');
    lines.push('```' + (req.bodyType === 'json' ? 'json' : ''), req.body, '```', '');
  }
}

/** Markdown 表格单元格转义 */
function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
