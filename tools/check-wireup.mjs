/**
 * check-wireup.mjs —— 「用了但没导入」静态检查
 *
 * 背景：这类错误 vite build 不会报（未声明的标识符在打包期只是被当作全局变量），
 * 只有用户点下去才暴露成 ReferenceError，表现为「按钮点了没反应」。
 * 2026-09-14 的定位按钮失效就是这个原因（App.jsx 调用 findRequestAncestorIds 却没 import）。
 *
 * 做法：
 *   1. 扫描 src 下所有模块的具名导出，建立 标识符 → 所属文件 的映射；
 *   2. 逐文件剥离注释与字符串（状态机，避免把 URL / 文案里的词当成代码）；
 *   3. 文件里出现某个「本该由别的模块提供」的标识符时，要求它要么被 import、要么在本文件声明。
 *
 * 误报逃生口：在相关行或上一行写 `// wireup-ignore`。
 *
 * 用法：node tools/check-wireup.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');

const EXT = new Set(['.js', '.jsx']);

/** 递归收集 src 下的源码文件 */
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      walk(p, out);
    } else if (EXT.has(path.extname(ent.name))) {
      out.push(p);
    }
  }
  return out;
}

/** 把被丢弃的片段换成等量换行 + 空格，保证行号不漂移 */
function blankLike(s) {
  const nls = (s.match(/\n/g) || []).length;
  return '\n'.repeat(nls) + ' '.repeat(Math.max(0, s.length - nls));
}

/**
 * 状态机扫描源码：
 *  - 注释（// 与 块注释）始终丢弃；
 *  - dropStrings 为 true 时连字符串/模板串内容一起去掉，只留代码形状。
 * 分两步用的原因：解析 import 必须保留 `from './x.js'` 的路径字符串，
 * 而扫描标识符用法又必须把字符串去掉，否则文案里出现的词会被当成代码。
 * 被丢弃的片段统一用 blankLike 占位，行号与原文一一对应。
 */
function scan(src, { dropStrings }) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      out += blankLike(src.slice(start, i));
      continue;
    }
    if (c === '/' && c2 === '*') {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += blankLike(src.slice(start, i));
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      const start = i;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          // 模板串插值里是代码：保留它（否则会漏判），按花括号配对跳过
          let depth = 1;
          i += 2;
          const innerStart = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          if (dropStrings) out += ' ' + src.slice(innerStart, i - 1) + ' ';
          continue;
        }
        i++;
      }
      const whole = src.slice(start, i);
      out += dropStrings ? blankLike(whole) : whole;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** import 语句整体匹配（含多行具名导入、副作用导入） */
const IMPORT_RE = /import\s+(?:[\s\S]*?\s+from\s*)?['"][^'"]*['"]\s*;?/g;

const ID = '[A-Za-z_$][A-Za-z0-9_$]*';

/** 提取一个文件对外暴露的具名标识符 */
function collectExports(code) {
  const names = new Set();
  const push = (s) => { if (s) names.add(s); };
  for (const m of code.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s+(${ID})`, 'g'))) push(m[1]);
  for (const m of code.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+(${ID})`, 'g'))) push(m[1]);
  for (const m of code.matchAll(new RegExp(`export\\s+class\\s+(${ID})`, 'g'))) push(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const asMatch = seg.match(new RegExp(`^(${ID})\\s+as\\s+(${ID})$`));
      push(asMatch ? asMatch[2] : seg);
    }
  }
  return names;
}

/** 提取本文件通过 import 绑定进来的标识符（逐条 import 语句解析） */
function collectImports(keptSource) {
  const names = new Set();
  const re = new RegExp(IMPORT_RE.source, 'g');
  let stmt;
  while ((stmt = re.exec(keptSource))) {
    const s = stmt[0];
    const fromIdx = s.lastIndexOf(' from ');
    const clause = fromIdx >= 0 ? s.slice('import'.length, fromIdx) : s.slice('import'.length);
    const def = clause.match(new RegExp(`^\\s*(${ID})`));
    if (def) names.add(def[1]);
    for (const brace of clause.matchAll(/\{([\s\S]*?)\}/g)) {
      for (const part of brace[1].split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const asMatch = seg.match(new RegExp(`^(${ID})\\s+as\\s+(${ID})$`));
        names.add(asMatch ? asMatch[2] : seg);
      }
    }
    for (const ns of clause.matchAll(new RegExp(`\\*\\s+as\\s+(${ID})`, 'g'))) names.add(ns[1]);
  }
  return names;
}

/** 提取本文件自行声明的标识符（变量 / 函数 / 类 / 解构 / 形参） */
function collectDeclared(code) {
  const names = new Set();
  for (const m of code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${ID})`, 'g'))) names.add(m[1]);
  for (const m of code.matchAll(new RegExp(`\\bfunction\\s+(${ID})`, 'g'))) names.add(m[1]);
  for (const m of code.matchAll(new RegExp(`\\bclass\\s+(${ID})`, 'g'))) names.add(m[1]);
  const addPattern = (inner) => {
    for (const part of inner.split(',')) {
      let seg = part.trim();
      if (!seg) continue;
      const asMatch = seg.match(new RegExp(`^(${ID})\\s*(?::|=)`));
      if (asMatch) seg = asMatch[1];
      const rest = seg.match(new RegExp(`\\.\\.\\.\\s*(${ID})`));
      if (rest) { names.add(rest[1]); continue; }
      if (new RegExp(`^${ID}$`).test(seg)) names.add(seg);
    }
  };
  // 对象解构声明：{ a, b: c } = ...  与  ({ a }, ...) => 
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=/g)) addPattern(m[1]);
  for (const m of code.matchAll(/\[([^[\]]*)\]\s*=/g)) addPattern(m[1]);
  // 形参：function f(a, b) / (a, b) => / a => / ({a, b}) => / ({a}) => 
  for (const m of code.matchAll(new RegExp(`\\bfunction\\s*${ID}?\\s*\\(([^()]*)\\)`, 'g'))) addPattern(m[1]);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) addPattern(m[1]);
  for (const m of code.matchAll(new RegExp(`(?:^|[^.\\w$])(${ID})\\s*=>`, 'g'))) names.add(m[1]);
  return names;
}

/** 提取文件里出现的、可能指向上游模块的标识符用法 */
function collectUsages(code, candidates) {
  const used = new Map(); // name -> first line
  const lines = code.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (const name of candidates) {
      const re = new RegExp(`(?<![A-Za-z0-9_$.])${name}(?![A-Za-z0-9_$])`, 'g');
      let m;
      while ((m = re.exec(line))) {
        const after = line.slice(m.index + name.length);
        const before = line.slice(0, m.index);
        // 对象字面量的键 `name:` 跳过
        if (/^\s*:/.test(after)) continue;
        // JSX 属性名 / 赋值左值 `name=` 跳过（`==`/`===` 比较不算）
        if (/^\s*=(?!=)/.test(after)) continue;
        // 紧跟在 import 子句里的名字由 collectImports 负责
        if (/^\s*import\b/.test(before) || /^\s*(const|let|var|function|class)\s+$/.test(before)) continue;
        if (!used.has(name)) used.set(name, { line: li + 1, text: line.trim() });
        break;
      }
    }
  }
  return used;
}

// ---- 主流程 ----
const files = walk(SRC);
/** 标识符 -> 导出它的文件集合 */
const exportOwners = new Map();
/** 文件 -> { code, imported, declared, rawLines } */
const parsed = new Map();

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  // 第一步：只去注释，保留字符串（import 的模块路径要留着才能解析）
  const kept = scan(raw, { dropStrings: false });
  // 第二步：把 import 语句整段抹掉（保留换行与长度，行号才不漂），再去字符串，得到纯净的「代码形状」
  const masked = kept.replace(new RegExp(IMPORT_RE.source, 'g'), (s) => blankLike(s));
  const code = scan(masked, { dropStrings: true });

  parsed.set(f, {
    code,
    imported: collectImports(kept),
    declared: collectDeclared(code),
    rawLines: raw.split('\n')
  });

  for (const name of collectExports(kept)) {
    if (!exportOwners.has(name)) exportOwners.set(name, new Set());
    exportOwners.get(name).add(f);
  }
}

const allExported = [...exportOwners.keys()];
const findings = [];

for (const [file, info] of parsed) {
  const { code, imported, declared } = info;
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const ignored = new Set();
  info.rawLines.forEach((l, i) => {
    if (l.includes('wireup-ignore')) ignored.add(i + 1);
  });

  // 只检查「本文件没导出、但被其它文件导出」的名字，避免自产自用型误报
  const candidates = allExported.filter((n) => {
    if (imported.has(n) || declared.has(n)) return false;
    const owners = exportOwners.get(n);
    return !(owners.size === 1 && owners.has(file));
  });

  for (const [name, where] of collectUsages(code, candidates)) {
    if (ignored.has(where.line) || ignored.has(where.line - 1)) continue;
    const owners = [...exportOwners.get(name)].map((p) => path.relative(ROOT, p).replace(/\\/g, '/'));
    findings.push({ rel, name, line: where.line, owners, text: where.text });
  }
}

if (findings.length === 0) {
  console.log(`[check-wireup] OK：${files.length} 个源文件，无「用了但没导入」的标识符。`);
  process.exit(0);
}

console.error(`[check-wireup] 发现 ${findings.length} 处「用了但没导入」（这类错误 build 不报，只在运行时炸）：\n`);
for (const f of findings) {
  console.error(`  ${f.rel}:${f.line}  标识符 \`${f.name}\` 未在本文件导入或声明`);
  console.error(`      来源可能是：${f.owners.join(' , ')}`);
  console.error(`      代码：${f.text.slice(0, 120)}`);
  console.error('');
}
console.error('修法：补 import；若确属误报，在相关行或上一行加 // wireup-ignore');
process.exit(1);
