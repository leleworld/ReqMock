/**
 * 轻量 JSON 语法高亮：把 JSON 文本切分为带类型的 token 列表
 * token 类型：key / string / number / boolean / null / plain
 */

/** 超过该长度不做高亮，避免大响应卡顿 */
export const HIGHLIGHT_MAX_LENGTH = 300000;

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function tokenizeJson(text) {
  const tokens = [];
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ type: 'plain', text: text.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      if (m[2]) {
        tokens.push({ type: 'key', text: m[1] });
        tokens.push({ type: 'plain', text: m[2] });
      } else {
        tokens.push({ type: 'string', text: m[1] });
      }
    } else if (m[3] !== undefined) {
      tokens.push({ type: m[3] === 'null' ? 'null' : 'boolean', text: m[3] });
    } else {
      tokens.push({ type: 'number', text: m[0] });
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < text.length) {
    tokens.push({ type: 'plain', text: text.slice(last) });
  }
  return tokens;
}
