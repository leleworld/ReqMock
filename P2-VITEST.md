# P2 — Vitest 测试框架集成指南

## 安装

```bash
cd C:\XYZ
npm install -D vitest @vitest/coverage-v8
```

## 配置

将 `vitest.config.js` 复制到项目根目录：

```bash
copy artifacts\refactor\p2-vitest\vitest.config.js C:\XYZ\vitest.config.js
```

## 添加 npm scripts

在 `package.json` 的 `scripts` 中添加：

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

## 测试目录结构

```
C:\XYZ/
├── tests/
│   ├── collectionUtil.test.js
│   ├── envUtil.test.js
│   ├── cookieUtil.test.js
│   ├── curlUtil.test.js
│   └── urlSync.test.js
├── vitest.config.js
└── ...
```

将 `tests/` 目录复制到项目根目录：

```bash
xcopy /E artifacts\refactor\p2-vitest\tests C:\XYZ\tests\
```

## 运行测试

```bash
# 单次运行
npm test

# 监听模式（开发时推荐）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

## 与现有冒烟测试整合

项目根目录已有 6 个冒烟测试文件：

| 文件 | 格式 |
|------|------|
| `smoke-test.cjs` | CommonJS |
| `realtime-smoke-test.cjs` | CommonJS |
| `collection-smoke-test.mjs` | ESM |
| `feature-smoke-test.mjs` | ESM |
| `runner-smoke-test.mjs` | ESM |
| `tabgroup-smoke-test.mjs` | ESM |
| `tools-smoke-test.mjs` | ESM |
| `urlsync-smoke-test.mjs` | ESM |

### 整合方式

1. 在 `tests/` 下创建 `smoke/` 子目录
2. 将现有冒烟测试移入并改名为 `.test.mjs` / `.test.cjs`
3. 用 vitest 的 `describe/it/expect` 包装断言

示例改写：

```js
// 原始 smoke-test.cjs
const assert = require('assert');
// ...一些断言逻辑

// 改写为 vitest 格式：tests/smoke/basic.test.cjs
const { describe, it, expect } = require('vitest');
describe('冒烟测试 - 基础', () => {
  it('...', () => { expect(...).toBe(...); });
});
```

或使用 vitest 的 `bench` 功能对性能敏感的冒烟测试做基准测试。

## 注意事项

- `src/utils/` 模块使用 ESM (`export/import`)，vitest 原生支持
- `curlUtil.js` 依赖 `graphqlUtil.js`，确保 import 路径正确
- `collectionUtil.js` 依赖 `authUtil.js` 和 `importFormats.js`
- 如需测试含 `crypto.randomUUID()` 的函数，vitest 的 Node 环境自带 `crypto`
- 部分函数使用了浏览器 `crypto.randomUUID()`，Node 18+ 也支持，无需 polyfill
