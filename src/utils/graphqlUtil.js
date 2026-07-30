/**
 * GraphQL 工具：请求体序列化 + introspection 拉取操作列表 + 操作骨架生成
 * 仅覆盖 Query / Mutation（不含 Subscription）
 */

/** 精简版 introspection：只取 Query/Mutation 根类型的字段签名（面板提示用，非完整 Docs） */
export const INTROSPECTION_QUERY = `query ReqMockIntrospection {
  __schema {
    queryType { name fields { name description args { name type { ...T } } type { ...T } } }
    mutationType { name fields { name description args { name type { ...T } } type { ...T } } }
  }
}
fragment T on __Type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }`;

/**
 * graphql 请求体 → 发送用 JSON 字符串（{query, variables?}）
 * variables 非法 JSON 时抛错
 */
export function serializeGraphqlBody(graphql) {
  const gq = graphql || {};
  const payload = { query: gq.query || '' };
  const varText = (gq.variables || '').trim();
  if (varText) {
    try {
      payload.variables = JSON.parse(varText);
    } catch (e) {
      throw new Error('GraphQL Variables 不是合法 JSON：' + e.message);
    }
  }
  return JSON.stringify(payload);
}

/** __Type 引用还原为可读类型名（[Foo!]! 形式） */
function typeName(t) {
  if (!t) return '';
  if (t.kind === 'NON_NULL') return typeName(t.ofType) + '!';
  if (t.kind === 'LIST') return '[' + typeName(t.ofType) + ']';
  return t.name || '';
}

/**
 * 解析 introspection 响应体，返回操作列表：
 * [{ kind: 'query'|'mutation', name, description, args: [{name, type}], returnType }]
 */
export function parseIntrospection(bodyText) {
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (e) {
    throw new Error('响应不是合法 JSON');
  }
  const schema = data && data.data && data.data.__schema;
  if (!schema) {
    const msg = data && data.errors && data.errors[0] && data.errors[0].message;
    throw new Error(msg ? '服务端返回错误：' + msg : '响应中没有 __schema（服务端可能禁用了 introspection）');
  }
  const ops = [];
  for (const [kind, root] of [['query', schema.queryType], ['mutation', schema.mutationType]]) {
    for (const f of (root && root.fields) || []) {
      ops.push({
        kind,
        name: f.name,
        description: f.description || '',
        args: (f.args || []).map((a) => ({ name: a.name, type: typeName(a.type) })),
        returnType: typeName(f.type)
      });
    }
  }
  return ops;
}

/** 由操作签名生成可直接编辑的骨架（变量声明 + 传参 + 空选择集） */
export function buildOperationSkeleton(op) {
  const varDefs = op.args.map((a) => `$${a.name}: ${a.type}`).join(', ');
  const argList = op.args.map((a) => `${a.name}: $${a.name}`).join(', ');
  const head = `${op.kind} ${op.name[0].toUpperCase()}${op.name.slice(1)}${varDefs ? `(${varDefs})` : ''}`;
  const call = `${op.name}${argList ? `(${argList})` : ''}`;
  // 标量返回值无选择集；其余留空待补
  const isScalar = /^(Int|Float|String|Boolean|ID)!?$/.test(op.returnType.replace(/[[\]]/g, ''));
  return `${head} {\n  ${call}${isScalar ? '' : ' {\n    # 选择返回字段\n  }'}\n}`;
}

/** 生成默认 Variables 骨架（每个参数一个 null 占位） */
export function buildVariablesSkeleton(op) {
  if (!op.args.length) return '';
  const obj = {};
  for (const a of op.args) obj[a.name] = null;
  return JSON.stringify(obj, null, 2);
}
