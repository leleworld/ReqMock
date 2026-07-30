/**
 * HTTP 请求发送模块（主进程执行，无 CORS 限制）
 * 基于 node http/https 实现，支持：
 *   - 阶段耗时统计（DNS / TCP / TLS / 首字节 / 下载）
 *   - 重定向链路追踪
 *   - 请求级 HTTP 代理（http 直转发 / https CONNECT 隧道）
 *   - multipart/form-data 文件上传
 *   - Set-Cookie 捕获（返回给渲染进程的 Cookie 管理器）
 *   - HTTP/2（https 直连）、SSL 证书校验开关、空值参数省略等号
 */
const http = require('http');
const https = require('https');
const http2 = require('http2');
const tls = require('tls');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const MAX_REDIRECTS = 10;

/**
 * 发送 HTTP 请求
 * @param payload {
 *   method, url, headers, params, bodyType: 'none'|'json'|'text'|'form'|'multipart'|'graphql',
 *   body, formData: [{key,value,type:'text'|'file',filePath,enabled}],
 *   graphql: {query, variables},
 *   timeoutMs, proxy, followRedirects,
 *   httpVersion: 'auto'|'h2', sslVerify, omitEmptyEq
 * }
 * @param signal 可选 AbortSignal，触发后中断当前请求（用户取消）
 * @returns { ok, status, statusText, headers, body, timeMs, sizeBytes, finalUrl,
 *            timings, trace, setCookies, httpVersion }
 *          或 { ok:false, error, errorCode, syscall, address, port, phase, timeMs, trace }
 */
async function sendHttpRequest(payload, signal) {
  const {
    method = 'GET', url, headers = [], params = [],
    bodyType = 'none', body = '', formData = [], graphql = null,
    timeoutMs = 30000, proxy = '', followRedirects = true,
    httpVersion = 'auto', sslVerify = true, omitEmptyEq = false
  } = payload;

  let finalUrl;
  try {
    finalUrl = new URL(url);
  } catch (e) {
    return { ok: false, error: 'URL 非法: ' + url, errorCode: 'BAD_URL', timeMs: 0 };
  }
  // Params 表中的 key 以表格为准：先移除 URL 中已存在的同名参数，避免与 query 镜像同步后重复发送
  for (const p of params) {
    if (p.key) finalUrl.searchParams.delete(p.key);
  }
  for (const p of params) {
    if (p.enabled !== false && p.key) finalUrl.searchParams.append(p.key, p.value ?? '');
  }
  // 空值参数省略等号：手动序列化 query（a= → a）
  if (omitEmptyEq) {
    const pairs = [];
    for (const [k, v] of finalUrl.searchParams) {
      pairs.push(v === '' ? encodeURIComponent(k) : encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    finalUrl.search = pairs.length ? '?' + pairs.join('&') : '';
  }

  const reqHeaders = {};
  for (const h of headers) {
    if (h.enabled !== false && h.key) reqHeaders[h.key] = h.value ?? '';
  }

  // ---- 构建请求体 ----
  let bodyBuffer = null;
  if (bodyType !== 'none' && method !== 'GET' && method !== 'HEAD') {
    if (bodyType === 'multipart') {
      try {
        const mp = buildMultipart(formData);
        bodyBuffer = mp.buffer;
        if (!hasHeader(reqHeaders, 'content-type')) {
          reqHeaders['Content-Type'] = `multipart/form-data; boundary=${mp.boundary}`;
        }
      } catch (e) {
        return { ok: false, error: '构建 multipart 失败：' + e.message, errorCode: 'BAD_MULTIPART', timeMs: 0 };
      }
    } else if (bodyType === 'graphql') {
      // graphql → {query, variables?} JSON body
      const gq = graphql || {};
      const gqPayload = { query: gq.query || '' };
      const varText = (gq.variables || '').trim();
      if (varText) {
        try {
          gqPayload.variables = JSON.parse(varText);
        } catch (e) {
          return { ok: false, error: 'GraphQL Variables 不是合法 JSON：' + e.message, errorCode: 'BAD_GRAPHQL_VARS', timeMs: 0 };
        }
      }
      bodyBuffer = Buffer.from(JSON.stringify(gqPayload), 'utf8');
      if (!hasHeader(reqHeaders, 'content-type')) {
        reqHeaders['Content-Type'] = 'application/json';
      }
    } else {
      bodyBuffer = Buffer.from(body || '', 'utf8');
      if (bodyType === 'json' && !hasHeader(reqHeaders, 'content-type')) {
        reqHeaders['Content-Type'] = 'application/json';
      } else if (bodyType === 'form' && !hasHeader(reqHeaders, 'content-type')) {
        reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
    if (bodyBuffer && !hasHeader(reqHeaders, 'content-length')) {
      reqHeaders['Content-Length'] = bodyBuffer.length;
    }
  }

  const startTime = Date.now();
  const trace = [];
  const setCookies = [];
  let curUrl = finalUrl;
  let curMethod = method;
  let curBody = bodyBuffer;
  let lastResult = null;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (signal && signal.aborted) throw makeError('请求已取消', 'REQ_CANCELED');
      const hopHeaders = { ...reqHeaders };
      if (hop > 0) delete hopHeaders['Host'];
      // HTTP/2 仅支持 https 直连；http 目标或走代理时自动回退 HTTP/1.1
      const useH2 = httpVersion === 'h2' && curUrl.protocol === 'https:' && !proxy;
      const res = useH2
        ? await doH2Request(curUrl, curMethod, hopHeaders, curBody, timeoutMs, sslVerify, signal)
        : await doSingleRequest(curUrl, curMethod, hopHeaders, curBody, timeoutMs, proxy, sslVerify, signal);
      lastResult = res;

      if (res.setCookies.length) setCookies.push(...res.setCookies.map((c) => ({ raw: c, url: curUrl.toString() })));
      trace.push({
        url: curUrl.toString(),
        method: curMethod,
        status: res.status,
        statusText: res.statusText,
        timeMs: res.timings.total,
        location: res.headers.location || ''
      });

      const isRedirect = [301, 302, 303, 307, 308].includes(res.status) && res.headers.location;
      if (!followRedirects || !isRedirect) break;

      curUrl = new URL(res.headers.location, curUrl);
      // 303 及浏览器惯例的 301/302 非 GET → 转 GET 并丢弃 body
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && curMethod !== 'GET' && curMethod !== 'HEAD')) {
        curMethod = 'GET';
        curBody = null;
        delete reqHeaders['Content-Type'];
        delete reqHeaders['Content-Length'];
      }
      if (hop === MAX_REDIRECTS) throw makeError('重定向次数超过上限 ' + MAX_REDIRECTS, 'TOO_MANY_REDIRECTS');
    }

    const decompressed = decompressBody(lastResult.rawBody, lastResult.headers['content-encoding']);
    const text = decompressed.toString('utf8');
    // 图片/PDF 等二进制响应额外附 base64（限 20MB），供渲染层预览与按原始字节保存
    const respType = lastResult.headers['content-type'] || '';
    const isBinary = /^(image|audio|video)\//i.test(respType) || /\b(pdf|octet-stream)\b/i.test(respType);
    const bodyBase64 = isBinary && decompressed.length <= 20 * 1024 * 1024
      ? decompressed.toString('base64') : undefined;
    return {
      ok: true,
      status: lastResult.status,
      statusText: lastResult.statusText,
      headers: lastResult.headers,
      body: text,
      bodyBase64,
      timeMs: Date.now() - startTime,
      sizeBytes: lastResult.rawBody.length,
      finalUrl: curUrl.toString(),
      timings: lastResult.timings,
      trace,
      setCookies,
      httpVersion: lastResult.httpVersion || '1.1'
    };
  } catch (e) {
    // 结构化错误：错误码/系统调用/目标地址/失败阶段，供失败视图给出中文解释与排查建议
    return {
      ok: false,
      error: e.message,
      errorCode: e.code || '',
      syscall: e.syscall || '',
      address: e.address || e.hostname || '',
      port: e.port || '',
      phase: inferFailPhase(e.reqTimings, curUrl.protocol === 'https:'),
      timeMs: Date.now() - startTime,
      trace
    };
  }
}

/** 构造带错误码的 Error（用于超时/取消等自定义错误） */
function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * 根据失败时已完成的阶段耗时推断死在哪一步
 * @returns 'dns'|'connect'|'tls'|'ttfb'|'download'|''（无法判断，如连接复用）
 */
function inferFailPhase(timings, isHttps) {
  if (!timings) return '';
  if (timings.ttfb >= 0) return 'download';
  if (timings.tls >= 0 || (!isHttps && timings.connect >= 0)) return 'ttfb';
  if (timings.connect >= 0) return isHttps ? 'tls' : 'ttfb';
  if (timings.dns >= 0) return 'connect';
  return '';
}

/** 发送单跳请求，返回 { status, statusText, headers, rawBody, timings, setCookies } */
function doSingleRequest(urlObj, method, headers, bodyBuffer, timeoutMs, proxy, sslVerify = true, signal) {
  return new Promise(async (resolve, reject) => {
    const isHttps = urlObj.protocol === 'https:';
    const timings = { dns: -1, connect: -1, tls: -1, ttfb: -1, download: -1, total: 0 };
    const t0 = Date.now();
    let tDns = 0, tConnect = 0, tTls = 0, tFirstByte = 0;
    let settled = false;
    let onAbort = null;
    const cleanup = () => { if (signal && onAbort) signal.removeEventListener('abort', onAbort); };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      // 把已完成的阶段耗时附在错误上，供上层推断失败阶段
      if (err && typeof err === 'object' && err.reqTimings === undefined) err.reqTimings = timings;
      reject(err);
    };
    if (signal) {
      if (signal.aborted) return fail(makeError('请求已取消', 'REQ_CANCELED'));
      onAbort = () => fail(makeError('请求已取消', 'REQ_CANCELED'));
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let options;
    let mod = isHttps ? https : http;
    try {
      if (proxy) {
        const proxyUrl = new URL(proxy);
        if (isHttps) {
          // https 目标：先 CONNECT 建隧道，再在隧道上做 TLS
          const socket = await connectTunnel(proxyUrl, urlObj.hostname, urlObj.port || 443, timeoutMs);
          tConnect = Date.now() - t0;
          options = {
            method,
            headers,
            path: urlObj.pathname + urlObj.search,
            host: urlObj.hostname,
            servername: urlObj.hostname,
            createConnection: () => tls.connect({ socket, servername: urlObj.hostname, rejectUnauthorized: sslVerify })
          };
        } else {
          // http 目标：直接把完整 URL 发给代理
          mod = http;
          options = {
            method,
            headers: { ...headers, Host: urlObj.host },
            host: proxyUrl.hostname,
            port: proxyUrl.port || 80,
            path: urlObj.toString()
          };
          if (proxyUrl.username) {
            options.headers['Proxy-Authorization'] =
              'Basic ' + Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password || '')}`).toString('base64');
          }
        }
      } else {
        options = {
          method,
          headers,
          host: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search
        };
        if (isHttps) options.rejectUnauthorized = sslVerify;
      }
    } catch (e) {
      return fail(e);
    }

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        if (!tFirstByte) {
          tFirstByte = Date.now() - t0;
          timings.ttfb = tFirstByte - (tTls || tConnect || tDns);
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        cleanup();
        const total = Date.now() - t0;
        timings.total = total;
        timings.download = tFirstByte ? total - tFirstByte : 0;
        if (timings.ttfb < 0) timings.ttfb = total - (tTls || tConnect || tDns);
        const resHeaders = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (k.toLowerCase() !== 'set-cookie') resHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        }
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage || '',
          headers: resHeaders,
          rawBody: Buffer.concat(chunks),
          timings,
          setCookies: res.headers['set-cookie'] || [],
          httpVersion: res.httpVersion || '1.1'
        });
      });
      res.on('error', fail);
    });

    req.on('socket', (socket) => {
      if (socket.connecting === false) return; // 复用连接，无阶段耗时
      socket.once('lookup', () => { tDns = Date.now() - t0; timings.dns = tDns; });
      socket.once('connect', () => {
        tConnect = Date.now() - t0;
        timings.connect = tConnect - tDns;
      });
      socket.once('secureConnect', () => {
        tTls = Date.now() - t0;
        timings.tls = tTls - (tConnect || tDns);
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(makeError(`请求超时（${timeoutMs}ms）`, 'REQ_TIMEOUT'));
    });
    req.on('error', fail);
    // 取消时销毁底层请求，尽快释放连接
    if (signal) signal.addEventListener('abort', () => { try { req.destroy(); } catch (e) { /* 已销毁 */ } }, { once: true });
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

/** HTTP/2 单跳请求（https 直连，不走代理），返回结构与 doSingleRequest 一致 */
function doH2Request(urlObj, method, headers, bodyBuffer, timeoutMs, sslVerify, signal) {
  return new Promise((resolve, reject) => {
    const timings = { dns: -1, connect: -1, tls: -1, ttfb: -1, download: -1, total: 0 };
    const t0 = Date.now();
    let tConnect = 0, tFirstByte = 0;
    let settled = false;
    let client = null;
    let onAbort = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      if (err && typeof err === 'object' && err.reqTimings === undefined) err.reqTimings = timings;
      try { if (client) client.close(); } catch (e) { /* 忽略关闭异常 */ }
      reject(err);
    };
    if (signal) {
      if (signal.aborted) return fail(makeError('请求已取消', 'REQ_CANCELED'));
      onAbort = () => fail(makeError('请求已取消', 'REQ_CANCELED'));
      signal.addEventListener('abort', onAbort, { once: true });
    }

    client = http2.connect(urlObj.origin, { rejectUnauthorized: sslVerify !== false });
    client.setTimeout(timeoutMs, () => fail(makeError(`请求超时（${timeoutMs}ms）`, 'REQ_TIMEOUT')));
    client.on('error', fail);
    client.once('connect', () => {
      tConnect = Date.now() - t0;
      timings.connect = tConnect;
      timings.tls = 0; // h2 连接建立包含 TLS，无法单独拆分
    });

    // h2 伪头部 + 过滤 HTTP/1.x 专属连接头
    const h2Headers = {
      ':method': method,
      ':path': urlObj.pathname + urlObj.search,
      ':authority': urlObj.host,
      ':scheme': 'https'
    };
    const FORBIDDEN = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);
    for (const [k, v] of Object.entries(headers)) {
      if (!FORBIDDEN.has(k.toLowerCase())) h2Headers[k.toLowerCase()] = String(v);
    }

    const req = client.request(h2Headers);
    let status = 0;
    const resHeaders = {};
    const setCookies = [];
    const chunks = [];
    req.on('response', (hdrs) => {
      status = hdrs[':status'] || 0;
      for (const [k, v] of Object.entries(hdrs)) {
        if (k.startsWith(':')) continue;
        if (k === 'set-cookie') {
          (Array.isArray(v) ? v : [v]).forEach((c) => setCookies.push(c));
          continue;
        }
        resHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
      }
    });
    req.on('data', (chunk) => {
      if (!tFirstByte) {
        tFirstByte = Date.now() - t0;
        timings.ttfb = tFirstByte - tConnect;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      const total = Date.now() - t0;
      timings.total = total;
      timings.download = tFirstByte ? total - tFirstByte : 0;
      if (timings.ttfb < 0) timings.ttfb = total - tConnect;
      client.close();
      resolve({
        status,
        statusText: '',
        headers: resHeaders,
        rawBody: Buffer.concat(chunks),
        timings,
        setCookies,
        httpVersion: '2'
      });
    });
    req.on('error', fail);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

/** 通过代理建立 CONNECT 隧道 */
function connectTunnel(proxyUrl, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const connectHeaders = {};
    if (proxyUrl.username) {
      connectHeaders['Proxy-Authorization'] =
        'Basic ' + Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password || '')}`).toString('base64');
    }
    const req = http.request({
      host: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: connectHeaders,
      timeout: timeoutMs
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket);
      else reject(makeError(`代理 CONNECT 失败：${res.statusCode}`, 'PROXY_ERROR'));
    });
    req.on('timeout', () => req.destroy(makeError('代理连接超时', 'PROXY_ERROR')));
    req.on('error', (e) => reject(makeError('代理连接失败：' + e.message, 'PROXY_ERROR')));
    req.end();
  });
}

/** 构建 multipart/form-data 请求体 */
function buildMultipart(formData) {
  const boundary = '----ReqMockBoundary' + Math.random().toString(36).slice(2);
  const parts = [];
  for (const f of formData || []) {
    if (f.enabled === false || !f.key) continue;
    if (f.type === 'file' && f.filePath) {
      const fileName = path.basename(f.filePath);
      const content = fs.readFileSync(f.filePath);
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"; filename="${fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`, 'utf8'
      ));
      parts.push(content);
      parts.push(Buffer.from('\r\n', 'utf8'));
    } else {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value ?? ''}\r\n`, 'utf8'
      ));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { buffer: Buffer.concat(parts), boundary };
}

/** 按 content-encoding 解压响应体，返回解压后的 Buffer */
function decompressBody(buffer, encoding) {
  try {
    if (encoding === 'gzip') return zlib.gunzipSync(buffer);
    if (encoding === 'deflate') return zlib.inflateSync(buffer);
    if (encoding === 'br') return zlib.brotliDecompressSync(buffer);
  } catch (e) { /* 解压失败按原文返回 */ }
  return buffer;
}

function hasHeader(headers, name) {
  return Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase());
}

module.exports = { sendHttpRequest };
