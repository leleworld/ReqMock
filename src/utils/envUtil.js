/**
 * 环境变量工具：{{变量名}} 替换
 */

export function newEnvironment(name = '新建环境') {
  return { id: crypto.randomUUID(), name, variables: [] };
}

/** 合并变量列表（导入全局变量用）：同名覆盖值并启用，新变量追加 */
export function mergeVariables(existing, incoming) {
  let vars = [...(existing || [])];
  for (const v of incoming || []) {
    if (!v || !v.key) continue;
    const idx = vars.findIndex((x) => x.key === v.key);
    if (idx >= 0) {
      vars = vars.map((x, i) => (i === idx ? { ...x, value: v.value ?? '', enabled: v.enabled !== false } : x));
    } else {
      vars = [...vars, { key: v.key, value: v.value ?? '', enabled: v.enabled !== false }];
    }
  }
  return vars;
}

/** 把全局变量与激活环境的变量合并为 Map（环境变量覆盖同名全局变量） */
export function buildVarMap(environment, globals) {
  const map = {};
  for (const v of globals || []) {
    if (v.enabled !== false && v.key) {
      map[v.key] = v.value ?? '';
    }
  }
  if (!environment) return map;
  for (const v of environment.variables || []) {
    if (v.enabled !== false && v.key) {
      map[v.key] = v.value ?? '';
    }
  }
  return map;
}

/** 替换字符串中的 {{var}} 占位符，未定义的变量保留原样 */
export function resolveVars(text, varMap) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(varMap, name) ? varMap[name] : match
  );
}

/** 对整个请求做变量替换（URL / Params / Headers / Body / GraphQL / 授权），返回新对象 */
export function resolveRequest(request, varMap) {
  const resolveKv = (rows) => (rows || []).map((r) => ({
    ...r,
    key: resolveVars(r.key, varMap),
    value: resolveVars(r.value, varMap)
  }));
  return {
    ...request,
    url: resolveVars(request.url, varMap),
    params: resolveKv(request.params),
    headers: resolveKv(request.headers),
    body: resolveVars(request.body, varMap),
    graphql: request.graphql ? {
      ...request.graphql,
      query: resolveVars(request.graphql.query, varMap),
      variables: resolveVars(request.graphql.variables, varMap)
    } : request.graphql,
    auth: request.auth ? {
      ...request.auth,
      username: resolveVars(request.auth.username, varMap),
      password: resolveVars(request.auth.password, varMap),
      token: resolveVars(request.auth.token, varMap),
      key: resolveVars(request.auth.key, varMap),
      value: resolveVars(request.auth.value, varMap)
    } : request.auth
  };
}

/** 找出文本中引用了但环境里未定义的变量名 */
export function findUnresolvedVars(text, varMap) {
  const missing = new Set();
  if (!text || typeof text !== 'string') return [];
  for (const m of text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
    if (!Object.prototype.hasOwnProperty.call(varMap, m[1])) missing.add(m[1]);
  }
  return [...missing];
}
