/**
 * Mock 渲染引擎（从 mockServer 抽出，便于复用与测试）：
 * - renderTemplate：{{params.x}} {{query.x}} {{header.x}} {{body.x}} {{now}} {{uuid}} {{random.*}}
 * - pickRule：条件响应规则匹配（按顺序，首个命中生效）
 */
const crypto = require('crypto');

// ---- 智能随机变量（faker 风格轻量实现） ----
const SURNAMES = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴'];
const GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '军', '洋', '勇', '杰', '涛', '明'];
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'kilo', 'lima'];
const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安', '重庆'];

function rint(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const RANDOM_GENERATORS = {
  int: () => String(rint(0, 10000)),
  float: () => (Math.random() * 1000).toFixed(2),
  bool: () => String(Math.random() < 0.5),
  name: () => SURNAMES[rint(0, SURNAMES.length - 1)] + GIVEN[rint(0, GIVEN.length - 1)] + (Math.random() < 0.5 ? GIVEN[rint(0, GIVEN.length - 1)] : ''),
  word: () => WORDS[rint(0, WORDS.length - 1)],
  email: () => `${WORDS[rint(0, WORDS.length - 1)]}${rint(1, 999)}@example.com`,
  phone: () => `1${rint(3, 9)}${String(rint(0, 999999999)).padStart(9, '0')}`,
  city: () => CITIES[rint(0, CITIES.length - 1)],
  date: () => {
    const d = new Date(Date.now() - rint(0, 365) * 86400000);
    return d.toISOString().slice(0, 10);
  },
  ip: () => `${rint(1, 254)}.${rint(0, 254)}.${rint(0, 254)}.${rint(1, 254)}`,
  color: () => '#' + rint(0, 0xffffff).toString(16).padStart(6, '0')
};

/** 可用随机变量名列表（面板提示用） */
const RANDOM_KEYS = Object.keys(RANDOM_GENERATORS);

/**
 * 模板渲染。context: { params, query, header, body }
 */
function renderTemplate(template, context) {
  return String(template ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (raw, expr) => {
    if (expr === 'now') return new Date().toISOString();
    if (expr === 'uuid') return crypto.randomUUID();
    const dotIndex = expr.indexOf('.');
    if (dotIndex < 0) return raw;
    const scope = expr.substring(0, dotIndex);
    const keyPath = expr.substring(dotIndex + 1);
    if (scope === 'random') {
      const gen = RANDOM_GENERATORS[keyPath];
      return gen ? gen() : raw;
    }
    const root = context[scope];
    if (root === undefined) return raw;
    const value = keyPath.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), root);
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/**
 * 条件响应规则匹配。
 * rule.when: { source: 'query'|'header'|'param'|'body', key, op: 'eq'|'neq'|'contains'|'exists'|'not-exists', value }
 * 规则按数组顺序评估，返回第一个启用且命中的规则；无命中返回 null。
 */
function pickRule(rules, context) {
  for (const rule of rules || []) {
    if (rule.enabled === false || !rule.when) continue;
    if (evalCondition(rule.when, context)) return rule;
  }
  return null;
}

function evalCondition(when, context) {
  const { source, key, op = 'eq', value = '' } = when;
  const scopeMap = { query: context.query, header: context.header, param: context.params, body: context.body };
  const root = scopeMap[source];
  if (!root || !key) return false;
  const lookupKey = source === 'header' ? key.toLowerCase() : key;
  const actualRaw = source === 'body'
    ? key.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), root)
    : root[lookupKey];
  const exists = actualRaw !== undefined && actualRaw !== null;
  const actual = exists ? (typeof actualRaw === 'object' ? JSON.stringify(actualRaw) : String(actualRaw)) : '';
  switch (op) {
    case 'exists': return exists;
    case 'not-exists': return !exists;
    case 'eq': return exists && actual === String(value);
    case 'neq': return !exists || actual !== String(value);
    case 'contains': return exists && actual.includes(String(value));
    default: return false;
  }
}

module.exports = { renderTemplate, pickRule, evalCondition, RANDOM_KEYS };
