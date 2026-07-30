/**
 * 脚本执行器：请求前置脚本 / 响应后置脚本（测试）
 *
 * 脚本内可用 API：
 *   rm.request                    当前请求（前置脚本中可修改 url/method/params/headers/body）
 *   rm.response                   响应对象（仅后置脚本，含 status/headers/body/json()）
 *   rm.env.get(key)               读取环境变量
 *   rm.env.set(key, value)        写入环境变量（保存到激活环境）
 *   rm.env.unset(key)             删除环境变量
 *   rm.test(name, fn)             定义测试，fn 抛错即失败
 *   rm.assert(cond, message)      断言
 *   console.log / warn / error    输出会显示在响应面板"测试"页签
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export async function runScript(code, { request, response, varMap }) {
  const logs = [];
  const tests = [];
  const envSet = {};
  const envUnset = new Set();

  const pushLog = (level) => (...args) => {
    logs.push({
      level,
      text: args.map((a) => (typeof a === 'object' ? safeStringify(a) : String(a))).join(' ')
    });
  };
  const fakeConsole = {
    log: pushLog('log'),
    info: pushLog('log'),
    warn: pushLog('warn'),
    error: pushLog('error')
  };

  const rm = {
    request,
    response: response ? {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: response.body,
      timeMs: response.timeMs,
      json() {
        try { return JSON.parse(response.body); } catch (e) { throw new Error('响应 Body 不是合法 JSON'); }
      }
    } : null,
    env: {
      get: (key) => (key in envSet ? envSet[key] : varMap[key]),
      set: (key, value) => { envSet[key] = String(value); envUnset.delete(key); },
      unset: (key) => { delete envSet[key]; envUnset.add(key); }
    },
    test: (name, fn) => {
      try {
        fn();
        tests.push({ name, passed: true });
      } catch (e) {
        tests.push({ name, passed: false, error: e.message });
      }
    },
    assert: (cond, message) => {
      if (!cond) throw new Error(message || '断言失败');
    }
  };

  try {
    const fn = new AsyncFunction('rm', 'console', code);
    await fn(rm, fakeConsole);
    return { ok: true, logs, tests, envSet, envUnset: [...envUnset], request: rm.request };
  } catch (e) {
    return { ok: false, error: e.message, logs, tests, envSet, envUnset: [...envUnset], request: rm.request };
  }
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}
