/**
 * 代码生成：把请求对象生成多语言调用代码
 * 输入请求应已完成变量替换与授权应用（headers 中已含 Authorization 等）
 */
import { toCurl } from './curlUtil.js';
import { serializeGraphqlBody } from './graphqlUtil.js';

export const CODEGEN_LANGS = [
  { value: 'curl', label: 'cURL' },
  { value: 'fetch', label: 'JavaScript (fetch)' },
  { value: 'axios', label: 'JavaScript (axios)' },
  { value: 'python', label: 'Python (requests)' },
  { value: 'java', label: 'Java (OkHttp)' },
  { value: 'go', label: 'Go (net/http)' },
  { value: 'powershell', label: 'PowerShell' }
];

/** Params 表合并进 URL（与发送时行为一致：表格 key 覆盖 URL 同名参数） */
export function buildFullUrl(request) {
  try {
    const u = new URL(request.url);
    for (const p of request.params || []) {
      if (p.key) u.searchParams.delete(p.key);
    }
    for (const p of request.params || []) {
      if (p.enabled !== false && p.key) u.searchParams.append(p.key, p.value ?? '');
    }
    return u.toString();
  } catch (e) {
    return request.url || '';
  }
}

function enabledHeaders(request) {
  return (request.headers || []).filter((h) => h.enabled !== false && h.key);
}

function hasBody(request) {
  return request.bodyType && request.bodyType !== 'none' && request.bodyType !== 'multipart' && request.body;
}

/** JS 双引号字符串字面量 */
function js(s) {
  return JSON.stringify(String(s ?? ''));
}

export function generateCode(lang, request) {
  // graphql 请求转为等价 JSON body 后走通用生成逻辑
  if (request.bodyType === 'graphql') {
    request = { ...request, bodyType: 'json', body: serializeGraphqlBody(request.graphql) };
  }
  const req = { ...request, url: buildFullUrl(request) };
  switch (lang) {
    case 'curl': return toCurl(request);
    case 'fetch': return genFetch(req);
    case 'axios': return genAxios(req);
    case 'python': return genPython(req);
    case 'java': return genJava(req);
    case 'go': return genGo(req);
    case 'powershell': return genPowershell(req);
    default: return '// 不支持的语言';
  }
}

function genFetch(req) {
  const headers = enabledHeaders(req);
  const lines = [`const response = await fetch(${js(req.url)}, {`];
  lines.push(`  method: ${js(req.method)},`);
  if (headers.length) {
    lines.push('  headers: {');
    lines.push(headers.map((h) => `    ${js(h.key)}: ${js(h.value)}`).join(',\n'));
    lines.push('  },');
  }
  if (hasBody(req)) lines.push(`  body: ${js(req.body)},`);
  lines.push('});');
  lines.push('const data = await response.text();');
  lines.push('console.log(response.status, data);');
  return lines.join('\n');
}

function genAxios(req) {
  const headers = enabledHeaders(req);
  const lines = ['const response = await axios({'];
  lines.push(`  method: ${js(req.method.toLowerCase())},`);
  lines.push(`  url: ${js(req.url)},`);
  if (headers.length) {
    lines.push('  headers: {');
    lines.push(headers.map((h) => `    ${js(h.key)}: ${js(h.value)}`).join(',\n'));
    lines.push('  },');
  }
  if (hasBody(req)) lines.push(`  data: ${js(req.body)},`);
  lines.push('});');
  lines.push('console.log(response.status, response.data);');
  return lines.join('\n');
}

function genPython(req) {
  const headers = enabledHeaders(req);
  const lines = ['import requests', ''];
  lines.push(`url = ${js(req.url)}`);
  if (headers.length) {
    lines.push('headers = {');
    lines.push(headers.map((h) => `    ${js(h.key)}: ${js(h.value)}`).join(',\n'));
    lines.push('}');
  }
  if (hasBody(req)) lines.push(`data = ${js(req.body)}`);
  const args = ['url'];
  if (headers.length) args.push('headers=headers');
  if (hasBody(req)) args.push('data=data.encode("utf-8")');
  lines.push('');
  lines.push(`response = requests.request(${js(req.method)}, ${args.join(', ')})`);
  lines.push('print(response.status_code)');
  lines.push('print(response.text)');
  return lines.join('\n');
}

function genJava(req) {
  const headers = enabledHeaders(req);
  const lines = ['OkHttpClient client = new OkHttpClient();', ''];
  if (hasBody(req)) {
    const ct = (headers.find((h) => h.key.toLowerCase() === 'content-type') || {}).value || 'application/json';
    lines.push(`MediaType mediaType = MediaType.parse(${js(ct)});`);
    lines.push(`RequestBody body = RequestBody.create(${js(req.body)}, mediaType);`);
  }
  lines.push('Request request = new Request.Builder()');
  lines.push(`    .url(${js(req.url)})`);
  lines.push(`    .method(${js(req.method)}, ${hasBody(req) ? 'body' : 'null'})`);
  for (const h of headers) {
    lines.push(`    .addHeader(${js(h.key)}, ${js(h.value)})`);
  }
  lines.push('    .build();');
  lines.push('');
  lines.push('try (Response response = client.newCall(request).execute()) {');
  lines.push('    System.out.println(response.code());');
  lines.push('    System.out.println(response.body().string());');
  lines.push('}');
  return lines.join('\n');
}

function genGo(req) {
  const headers = enabledHeaders(req);
  const lines = ['package main', '', 'import ('];
  lines.push('\t"fmt"');
  lines.push('\t"io"');
  lines.push('\t"net/http"');
  if (hasBody(req)) lines.push('\t"strings"');
  lines.push(')', '', 'func main() {');
  if (hasBody(req)) {
    lines.push(`\tpayload := strings.NewReader(${js(req.body)})`);
    lines.push(`\treq, _ := http.NewRequest(${js(req.method)}, ${js(req.url)}, payload)`);
  } else {
    lines.push(`\treq, _ := http.NewRequest(${js(req.method)}, ${js(req.url)}, nil)`);
  }
  for (const h of headers) {
    lines.push(`\treq.Header.Set(${js(h.key)}, ${js(h.value)})`);
  }
  lines.push('\tres, err := http.DefaultClient.Do(req)');
  lines.push('\tif err != nil { panic(err) }');
  lines.push('\tdefer res.Body.Close()');
  lines.push('\tbody, _ := io.ReadAll(res.Body)');
  lines.push('\tfmt.Println(res.StatusCode)');
  lines.push('\tfmt.Println(string(body))');
  lines.push('}');
  return lines.join('\n');
}

function genPowershell(req) {
  const headers = enabledHeaders(req);
  const ps = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
  const lines = [];
  if (headers.length) {
    lines.push('$headers = @{');
    lines.push(headers.map((h) => `  ${ps(h.key)} = ${ps(h.value)}`).join('\n'));
    lines.push('}');
  }
  if (hasBody(req)) lines.push(`$body = ${ps(req.body)}`);
  const args = [`-Uri ${ps(req.url)}`, `-Method ${req.method}`];
  if (headers.length) args.push('-Headers $headers');
  if (hasBody(req)) args.push('-Body $body');
  lines.push(`$response = Invoke-RestMethod ${args.join(' ')}`);
  lines.push('$response | ConvertTo-Json -Depth 10');
  return lines.join('\n');
}
