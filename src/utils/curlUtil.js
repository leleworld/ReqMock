/**
 * cURL 命令解析与生成 + 原始 HTTP 报文解析
 * parseCurl:    cURL 命令文本 → 请求对象（method/url/headers/body/bodyType/auth）
 * parseRawHttp: 原始 HTTP 请求报文 → 请求对象
 * toCurl:       请求对象 → cURL 命令文本
 */
import { serializeGraphqlBody } from './graphqlUtil.js';

/** 带值的选项但本工具不关心，需要跳过其参数 */
const VALUE_FLAGS_IGNORED = new Set([
  '-o', '--output', '-x', '--proxy', '-m', '--max-time', '--connect-timeout',
  '-c', '--cookie-jar', '-w', '--write-out', '--cacert', '--capath',
  '-E', '--cert', '--key', '--retry', '--limit-rate', '-r', '--range',
  '-D', '--dump-header', '-T', '--upload-file', '--resolve', '--interface',
  '-U', '--proxy-user'
]);

/**
 * 分词：处理单双引号、转义符与行续接（\ / ^ / ` + 换行）
 */
function tokenize(text) {
  const s = text.replace(/[\\^`]\r?\n/g, ' ');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    let tok = '';
    while (i < s.length && !/\s/.test(s[i])) {
      const ch = s[i];
      if (ch === '$' && s[i + 1] === "'") {
        i++; // bash $'...' 语法，忽略 $ 前缀
      } else if (ch === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) { tok += s.slice(i + 1); i = s.length; break; }
        tok += s.slice(i + 1, end);
        i = end + 1;
      } else if (ch === '"') {
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < s.length) { tok += s[i + 1]; i += 2; }
          else { tok += s[i]; i++; }
        }
        i++;
      } else if (ch === '\\' && i + 1 < s.length) {
        tok += s[i + 1]; i += 2;
      } else {
        tok += ch; i++;
      }
    }
    tokens.push(tok);
  }
  return tokens;
}

/**
 * 解析 cURL 命令，无法解析时抛错
 * @returns { method, url, headers, params, bodyType, body, auth? }
 */
export function parseCurl(text) {
  const tokens = tokenize(text || '');
  if (tokens.length === 0) throw new Error('内容为空');

  let i = 0;
  while (i < tokens.length && /^(\$|curl(\.exe)?)$/i.test(tokens[i])) i++;

  let method = '';
  let url = '';
  let isForm = false;
  let moveDataToQuery = false;
  const headers = [];
  const dataParts = [];
  const formParts = [];
  let auth = null;

  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--request') {
      method = (tokens[++i] || '').toUpperCase();
    } else if (t === '-H' || t === '--header') {
      const h = tokens[++i] || '';
      const ci = h.indexOf(':');
      if (ci > 0) headers.push({ key: h.slice(0, ci).trim(), value: h.slice(ci + 1).trim(), enabled: true });
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' ||
               t === '--data-ascii' || t === '--data-urlencode') {
      dataParts.push(tokens[++i] || '');
    } else if (t === '-F' || t === '--form') {
      isForm = true;
      formParts.push(tokens[++i] || '');
    } else if (t === '-u' || t === '--user') {
      const u = tokens[++i] || '';
      const ci = u.indexOf(':');
      auth = {
        type: 'basic',
        username: ci >= 0 ? u.slice(0, ci) : u,
        password: ci >= 0 ? u.slice(ci + 1) : ''
      };
    } else if (t === '-b' || t === '--cookie') {
      headers.push({ key: 'Cookie', value: tokens[++i] || '', enabled: true });
    } else if (t === '-A' || t === '--user-agent') {
      headers.push({ key: 'User-Agent', value: tokens[++i] || '', enabled: true });
    } else if (t === '-e' || t === '--referer') {
      headers.push({ key: 'Referer', value: tokens[++i] || '', enabled: true });
    } else if (t === '--url') {
      url = tokens[++i] || '';
    } else if (t === '-I' || t === '--head') {
      if (!method) method = 'HEAD';
    } else if (t === '-G' || t === '--get') {
      moveDataToQuery = true;
    } else if (VALUE_FLAGS_IGNORED.has(t)) {
      i++;
    } else if (t.startsWith('-')) {
      // 其余布尔选项（-s -k -L --compressed 等）忽略
    } else if (!url) {
      url = t;
    }
  }

  if (!url) throw new Error('未找到请求 URL');
  if (!/^[a-zA-Z][\w+.-]*:\/\//.test(url)) url = 'http://' + url;

  let body = isForm ? formParts.filter(Boolean).join('&') : dataParts.join('&');
  if (moveDataToQuery && body) {
    url += (url.includes('?') ? '&' : '?') + body;
    body = '';
  }
  if (!method) method = body ? 'POST' : 'GET';

  const ct = (headers.find((h) => h.key.toLowerCase() === 'content-type') || { value: '' }).value.toLowerCase();
  let bodyType = 'none';
  if (body) {
    if (isForm || ct.includes('form')) bodyType = 'form';
    else if (ct.includes('json') || /^\s*[[{]/.test(body)) bodyType = 'json';
    else bodyType = 'text';
  }

  return { method, url, headers, params: [], bodyType, body, auth: auth || undefined };
}

/**
 * 解析原始 HTTP 请求报文，无法解析时抛错
 * 首行：METHOD SP path或完整URL [SP HTTP/x]；后续行为 Header；空行后为 Body
 * @returns { method, url, headers, params, bodyType, body }
 */
export function parseRawHttp(text) {
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/^\n+/, '');
  if (!s.trim()) throw new Error('内容为空');
  const sep = s.indexOf('\n\n');
  const head = sep >= 0 ? s.slice(0, sep) : s;
  const body = sep >= 0 ? s.slice(sep + 2).replace(/\n+$/, '') : '';
  const lines = head.split('\n');
  const m = lines[0].trim().match(/^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/);
  if (!m) throw new Error('首行不是合法的请求行（如 GET /path HTTP/1.1）');
  const method = m[1].toUpperCase();
  const target = m[2];

  const headers = [];
  let host = '';
  for (const line of lines.slice(1)) {
    const ci = line.indexOf(':');
    if (ci <= 0) continue;
    const key = line.slice(0, ci).trim();
    const value = line.slice(ci + 1).trim();
    if (key.toLowerCase() === 'host' && !host) host = value;
    headers.push({ key, value, enabled: true });
  }

  let url = target;
  if (!/^[a-zA-Z][\w+.-]*:\/\//.test(url)) {
    if (!host) throw new Error('缺少 Host 请求头，无法拼出完整 URL');
    const scheme = /:443$/.test(host) ? 'https://' : 'http://';
    url = scheme + host + (target.startsWith('/') ? target : '/' + target);
  }

  const ct = (headers.find((h) => h.key.toLowerCase() === 'content-type') || { value: '' }).value.toLowerCase();
  let bodyType = 'none';
  if (body.trim()) {
    if (ct.includes('json') || /^\s*[[{]/.test(body)) bodyType = 'json';
    else if (ct.includes('x-www-form-urlencoded')) bodyType = 'form';
    else bodyType = 'text';
  }

  return { method, url, headers, params: [], bodyType, body: body.trim() ? body : '' };
}

/** 单引号安全包裹 */
function quote(s) {
  return `'${String(s ?? '').replace(/'/g, `'\\''`)}'`;
}

/** apikey 放 query 时把参数并入导出 URL */
function buildExportUrl(request) {
  let url = request.url || '';
  const auth = request.auth;
  if (auth && auth.type === 'apikey' && auth.addTo === 'query' && auth.key) {
    url += (url.includes('?') ? '&' : '?') + `${auth.key}=${auth.value || ''}`;
  }
  return url;
}

/** 请求对象 → cURL 命令（多行，\ 续接） */
export function toCurl(request) {
  // graphql 请求转为等价 JSON body 后走通用逻辑
  if (request.bodyType === 'graphql') {
    request = { ...request, bodyType: 'json', body: serializeGraphqlBody(request.graphql) };
  }
  const parts = [`curl -X ${request.method || 'GET'} ${quote(buildExportUrl(request))}`];
  const headers = (request.headers || []).filter((h) => h.enabled !== false && h.key);
  const hasCt = headers.some((h) => h.key.toLowerCase() === 'content-type');
  for (const h of headers) {
    parts.push(`-H ${quote(`${h.key}: ${h.value ?? ''}`)}`);
  }

  const auth = request.auth;
  if (auth) {
    if (auth.type === 'basic') {
      parts.push(`-u ${quote(`${auth.username || ''}:${auth.password || ''}`)}`);
    } else if (auth.type === 'bearer') {
      parts.push(`-H ${quote(`Authorization: Bearer ${auth.token || ''}`)}`);
    } else if (auth.type === 'apikey' && auth.key && auth.addTo !== 'query') {
      parts.push(`-H ${quote(`${auth.key}: ${auth.value || ''}`)}`);
    }
  }

  if (request.bodyType && request.bodyType !== 'none' && request.body) {
    if (!hasCt) {
      if (request.bodyType === 'json') parts.push(`-H ${quote('Content-Type: application/json')}`);
      else if (request.bodyType === 'form') parts.push(`-H ${quote('Content-Type: application/x-www-form-urlencoded')}`);
    }
    parts.push(`-d ${quote(request.body)}`);
  }
  return parts.join(' \\\n  ');
}
