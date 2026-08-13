/**
 * Mock 脚本化响应：node:vm 沙箱执行用户脚本构造响应
 * 上下文仅注入只读 request 与可写 response（无 require / 网络 / 文件能力），
 * 脚本通过修改 response.status / response.headers / response.body 定制返回。
 */
const vm = require('vm');

const SCRIPT_TIMEOUT_MS = 1000;

/** 保存对原始 JSON 的引用，防止沙箱脚本污染 */
const nativeJSON = { parse: JSON.parse, stringify: JSON.stringify };

/**
 * 执行脚本化响应。
 * @param script 用户脚本文本
 * @param request { method, path, params, query, headers, body }
 * @returns { ok:true, status, headers, body } 或 { ok:false, error }
 */
function runMockScript(script, request) {
  const response = { status: 200, headers: {}, body: '' };
  const sandbox = {
    request: nativeJSON.parse(nativeJSON.stringify(request)),
    response,
    JSON: {
      parse: JSON.parse.bind(JSON),
      stringify: JSON.stringify.bind(JSON),
      keys: Object.keys
    },
    Math,
    Date
  };
  try {
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(String(script || ''), context, { timeout: SCRIPT_TIMEOUT_MS });
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }

  const status = parseInt(response.status, 10) || 200;
  const headers = {};
  if (response.headers && typeof response.headers === 'object') {
    for (const [k, v] of Object.entries(response.headers)) {
      if (k) headers[k] = String(v ?? '');
    }
  }
  // body 为对象时自动 JSON 序列化
  const body = typeof response.body === 'string'
    ? response.body
    : JSON.stringify(response.body ?? '', null, 2);
  return { ok: true, status, headers, body };
}

module.exports = { runMockScript, SCRIPT_TIMEOUT_MS };
