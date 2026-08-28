#!/usr/bin/env node
/**
 * 构建期校验：CSS 中 var(--x) 引用的自定义属性必须存在定义。
 *
 * 背景：曾有一批样式按 --bg-primary / --bg-secondary / --bg-tertiary / --bg-sidebar /
 * --bg-input / --radius-l / --accent-bg 书写，而 :root 从未定义这些名字，于是
 * 永远走 fallback 里的硬编码深色 —— 浅色主题下设置页深底深字、活动栏背景整条声明失效、
 * 焦点环与圆角静默丢失。这类问题浏览器不会报错，只能靠静态检查拦住。
 *
 * 定义来源（任一即算已定义）：
 *   1. 任意 .css 里的 `--x:` 声明（含 :root 与各主题块）
 *   2. JSX/JS 里以 '--x' 字符串形式注入的运行时变量（内联 style、setProperty）
 *
 * 用法：node tools/check-css-tokens.mjs   （已接进 npm run build 前置）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SCAN_ROOTS = ['src', 'electron'];
const EXTS = /\.(css|jsx?|cjs|mjs)$/;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXTS.test(name)) files.push(p);
  }
};
for (const r of SCAN_ROOTS) {
  try { walk(r); } catch { /* 目录不存在则跳过 */ }
}

const used = new Map(); // token -> [file:line, ...]
const defined = new Set();

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)) {
      const k = m[1];
      if (!used.has(k)) used.set(k, []);
      if (used.get(k).length < 3) used.get(k).push(`${f}:${i + 1}`);
    }
    // CSS 声明：行首/空格/{/; 之后的 --x:
    for (const m of ln.matchAll(/(^|[\s{;])--([A-Za-z0-9-]+)\s*:/g)) defined.add(`--${m[2]}`);
    // 运行时注入：'--x' / "--x" / `--x`
    for (const m of ln.matchAll(/['"`](--[A-Za-z0-9-]+)['"`]/g)) defined.add(m[1]);
  });
}

const missing = [...used.keys()].filter((k) => !defined.has(k));

if (missing.length) {
  console.error('\n[x] CSS token 校验失败：以下 var() 引用的自定义属性没有任何定义');
  for (const k of missing) console.error(`    ${k}  ←  ${used.get(k).join('  ')}`);
  console.error('    修复：在 :root 定义它（或映射到已有 token），或直接改用已有 token。');
  console.error('    否则该声明会静默走 fallback 硬编码值，甚至整条失效。\n');
  process.exit(1);
}

console.log(`[ok] CSS token 校验通过：${used.size} 个被引用 token 全部有定义（扫描 ${files.length} 个文件）`);
