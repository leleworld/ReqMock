# P2: CSS Modules 迁移方案

## 📋 概述

将 `src/styles.css`（~98KB, 2100+ 行）拆分为 CSS Modules 架构，实现：
- 🔒 组件级样式隔离（类名自动 hash，消除全局冲突）
- 🎨 主题系统不变（:root[data-theme] CSS 变量机制完全保留）
- 📦 按需加载（Vite 自动 tree-shaking 未使用的模块样式）
- 🛠️ 渐进式迁移（可逐组件迁移，新旧并存）

---

## 🏗️ 目标文件结构

```
src/
├── styles/
│   ├── global.css              # 主题 tokens + reset + 全局字体
│   ├── layout.css              # App Shell + 分栏 + 状态栏
│   └── shared.css              # 共享的全局辅助类（可选）
├── components/
│   ├── Sidebar.jsx
│   ├── Sidebar.module.css      # ← 与组件同目录
│   ├── TabBar.jsx
│   ├── TabBar.module.css
│   ├── ResponsePanel.jsx
│   ├── ResponsePanel.module.css
│   ├── RequestEditor.jsx
│   ├── RequestEditor.module.css
│   ├── CollectionTree.module.css
│   ├── CommandPalette.module.css
│   ├── CodeEditor.module.css
│   ├── KeyValueEditor.module.css
│   ├── Modals.module.css
│   ├── TopBar.module.css
│   ├── WelcomePage.module.css
│   └── ...                     # 每个组件一个 .module.css
├── main.jsx                    # import './styles/global.css'; import './styles/layout.css';
└── App.jsx
```

---

## 🎯 拆分策略

### 层级 1：global.css（~200 行）

| 内容 | 说明 |
|------|------|
| Reset (`* { box-sizing… }`) | 全局生效 |
| `:root` CSS 变量 | 所有设计 tokens |
| `:root[data-theme='xxx']` | 8 套主题 + 3 个质感校准块 |
| `:root[data-accent='xxx']` | 强调色覆盖 |
| `body` 字体/颜色 | 全局基础 |
| 滚动条样式 | webkit 全局 |
| 骨架屏 / spinner 动画 | 多组件复用 |

### 层级 2：layout.css（~80 行）

| 内容 | 说明 |
|------|------|
| `.app` / `.app-body` | 顶层 flex 骨架 |
| `.request-workspace` | 请求/响应分栏容器 |
| `.split-resizer-*` | 分割手柄 |
| `.status-bar` / `.status-item` | 底部状态栏 |
| `.layout-horizontal` | 横向布局变体 |

### 层级 3：组件 .module.css（各 50-200 行）

每个 `.module.css` 只包含对应组件的样式，命名转为 **camelCase**：

| 原始 CSS 段落 | 目标模块 |
|---|---|
| 左侧活动栏 + 导航面板 | `Sidebar.module.css` |
| 主区统一标签栏 + 标签分组 | `TabBar.module.css` |
| 响应面板 + 诊断视图 + JSON 高亮 | `ResponsePanel.module.css` |
| 请求编辑器 + 请求栏 + editor-tabs | `RequestEditor.module.css` |
| 键值编辑器 + 批量编辑 | `KeyValueEditor.module.css` |
| 集合树 + 搜索框 + 空态引导 | `CollectionTree.module.css` |
| 命令面板 / 全局搜索 | `CommandPalette.module.css` |
| 模态框 + Toast + 通知中心 | `Modals.module.css` |
| 顶部全局栏 + 环境切换器 | `TopBar.module.css` |
| 欢迎页 + 关于对话框 | `WelcomePage.module.css` |
| Mock 面板 | `MockPanel.module.css` |
| WebSocket / SSE 面板 | `WsPanel.module.css` |
| Runner 面板 | `RunnerPanel.module.css` |
| Cookie 面板 | `CookiePanel.module.css` |
| 环境面板 | `EnvironmentPanel.module.css` |
| 工具面板 | `ToolsPanel.module.css` |
| CodeEditor（CodeMirror 包装） | `CodeEditor.module.css` |
| 设置弹窗 | `Settings.module.css` |

---

## 🔄 迁移步骤（渐进式）

### 阶段 0：准备（不破坏现有代码）

```bash
# 1. 创建 styles 目录
mkdir src/styles

# 2. 将 global.css 和 layout.css 放入
# 3. 在 main.jsx 追加新导入（保留旧 import）
```

```jsx
// main.jsx — 过渡阶段同时导入新旧
import './styles/global.css';
import './styles/layout.css';
import './styles.css'; // ← 暂时保留，逐步删减
```

### 阶段 1：逐组件迁移

以 **Sidebar.jsx** 为例：

**1) 创建 `Sidebar.module.css`**（从 styles.css 中提取对应区块）

**2) 修改组件导入：**

```jsx
// Sidebar.jsx
import styles from './Sidebar.module.css';
```

**3) 替换 className：**

```jsx
// 旧：
<div className="activity-bar">
<button className={`activity-btn ${active ? 'active' : ''}`}>

// 新：
<div className={styles.activityBar}>
<button className={`${styles.activityBtn} ${active ? styles.active : ''}`}>
```

**4) 从 `styles.css` 中删除已迁移的 CSS 块**

**5) 运行 & 验证视觉回归**

### 阶段 2：处理跨组件共享样式

对于多组件共享的类（如 `.btn`, `.seg-btn`, `.hint`），有两种策略：

**策略 A：提升到 global.css**
```css
/* global.css 中保留 */
.btn { ... }
.btn-primary { ... }
.seg-btn { ... }
```

**策略 B：使用 composes 引用**
```css
/* Button.module.css */
.btn { /* 基础按钮 */ }

/* Sidebar.module.css */
.exportBtn {
  composes: btn from '../shared/Button.module.css';
  /* 额外样式 */
}
```

### 阶段 3：清理

- 删除 `src/styles.css`
- 从 `main.jsx` 移除旧 import
- 验证所有主题正确切换

---

## 🔑 类名映射规则

| 原始 CSS（kebab-case） | CSS Module（camelCase） | 说明 |
|---|---|---|
| `.activity-bar` | `.activityBar` | 直接 camelCase |
| `.side-panel-header` | `.sidePanelHeader` | 多级连词 |
| `.tab-item.active` | `.tabItem` + 条件拼 `.active` | 状态类保持短名 |
| `.method-GET` | `.methodGET` | 方法标签 |
| `.tab-fade-l` | `.tabFadeL` | 方向后缀 |

### 状态类处理模式

```jsx
// 简单条件
className={`${styles.tabItem} ${isActive ? styles.active : ''}`}

// 多状态（推荐 clsx 库）
import clsx from 'clsx';
className={clsx(styles.tabItem, { [styles.active]: isActive, [styles.dirty]: isDirty })}
```

---

## 🛠️ 迁移脚本思路

### 自动化辅助脚本 `scripts/migrate-css-modules.mjs`

```javascript
#!/usr/bin/env node
/**
 * CSS Modules 迁移辅助脚本
 * 
 * 功能：
 * 1. 扫描组件 JSX 中使用的 className
 * 2. 从 styles.css 中提取匹配的选择器块
 * 3. 生成 .module.css 文件（转 camelCase）
 * 4. 生成 JSX className 替换 diff
 */
import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'path';

// --- 步骤 1：解析组件使用的 class ---
function extractClassNames(jsxContent) {
  const classNames = new Set();
  // 匹配 className="xxx" 和 className={`xxx ${...}`}
  const staticRe = /className="([^"]+)"/g;
  const templateRe = /className=\{`([^`]+)`\}/g;
  
  let m;
  while ((m = staticRe.exec(jsxContent))) {
    m[1].split(/\s+/).forEach(c => classNames.add(c));
  }
  while ((m = templateRe.exec(jsxContent))) {
    // 提取模板中的静态部分
    m[1].replace(/\$\{[^}]+\}/g, '').split(/\s+/)
      .filter(Boolean).forEach(c => classNames.add(c));
  }
  return classNames;
}

// --- 步骤 2：从 CSS 中提取选择器块 ---
function extractCssBlocks(cssContent, classNames) {
  const blocks = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(cssContent))) {
    const selector = m[1].trim();
    const body = m[2].trim();
    for (const cn of classNames) {
      if (selector.includes(`.${cn}`)) {
        blocks.push({ selector, body });
        break;
      }
    }
  }
  return blocks;
}

// --- 步骤 3：kebab-case → camelCase 转换 ---
function toCamelCase(str) {
  return str.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

// --- 步骤 4：生成 module.css ---
function generateModule(blocks, classNames) {
  let output = '';
  for (const block of blocks) {
    let selector = block.selector;
    for (const cn of classNames) {
      selector = selector.replace(`.${cn}`, `.${toCamelCase(cn)}`);
    }
    output += `${selector} {\n  ${block.body.replace(/;\s*/g, ';\n  ').trim()}\n}\n\n`;
  }
  return output;
}

// --- 步骤 5：生成 JSX 替换建议 ---
function generateJsxDiff(classNames) {
  const mapping = {};
  for (const cn of classNames) {
    mapping[cn] = `styles.${toCamelCase(cn)}`;
  }
  return mapping;
}

// 使用示例：
// node scripts/migrate-css-modules.mjs src/components/Sidebar.jsx
const [,, componentPath] = process.argv;
if (componentPath) {
  const jsx = readFileSync(componentPath, 'utf-8');
  const css = readFileSync('src/styles.css', 'utf-8');
  const classes = extractClassNames(jsx);
  const blocks = extractCssBlocks(css, classes);
  const moduleContent = generateModule(blocks, classes);
  const modulePath = componentPath.replace(/\.jsx$/, '.module.css');
  writeFileSync(modulePath, moduleContent);
  console.log(`✅ Generated: ${modulePath}`);
  console.log(`   Classes: ${[...classes].join(', ')}`);
  console.log('\n📝 JSX mapping:');
  const mapping = generateJsxDiff(classes);
  Object.entries(mapping).forEach(([k, v]) => console.log(`   "${k}" → ${v}`));
}
```

### 使用方式

```bash
# 单组件迁移
node scripts/migrate-css-modules.mjs src/components/Sidebar.jsx

# 批量迁移（所有组件）
for f in src/components/*.jsx; do
  node scripts/migrate-css-modules.mjs "$f"
done
```

---

## ⚡ Vite 配置变更

### 当前配置（无需修改！）

Vite **原生支持** CSS Modules —— 任何以 `.module.css` 结尾的文件自动启用模块化。当前 `vite.config.js` **不需要任何改动**即可使用。

### 可选优化配置

如果需要自定义类名格式（方便调试），可以添加：

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  css: {
    modules: {
      // 开发环境：组件名_类名_hash（方便调试）
      // 生产环境：短 hash（减小体积）
      generateScopedName: process.env.NODE_ENV === 'production'
        ? '[hash:base64:6]'
        : '[name]__[local]__[hash:base64:4]',
      // 确保 camelCase 导出（JS 中用 styles.activityBar）
      localsConvention: 'camelCaseOnly'
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  }
});
```

### 关键配置说明

| 选项 | 值 | 作用 |
|------|------|------|
| `generateScopedName` | dev: `[name]__[local]__[hash:base64:4]` | 开发时 DOM 中显示 `Sidebar__activityBar__a1b2` |
| `generateScopedName` | prod: `[hash:base64:6]` | 生产构建最小化类名 |
| `localsConvention` | `'camelCaseOnly'` | CSS 中写 `.activity-bar`，JS 中自动可用 `styles.activityBar` |

### localsConvention: 'camelCaseOnly' 的好处

允许在 `.module.css` 中继续用 **kebab-case** 写 CSS，但 JS 导入时自动获得 camelCase 键：

```css
/* Sidebar.module.css */
.activity-bar { ... }
.side-panel { ... }
```

```jsx
// Sidebar.jsx
import styles from './Sidebar.module.css';
// styles.activityBar ✓（自动转换）
// styles['activity-bar'] ✗（被过滤）
```

---

## ⚠️ 注意事项

### 1. 主题系统完全保留

CSS Modules 只作用于 **类选择器**。`:root[data-theme]` 定义的 CSS 变量仍然在 `global.css` 中全局生效，所有 `.module.css` 中的 `var(--xxx)` 引用正常工作。

### 2. 第三方样式（CodeMirror）不受影响

CodeMirror 等第三方库的 `.cm-*` 类名不在 Module 范围内。如果需要覆盖：

```css
/* CodeEditor.module.css */
.editorWrap :global(.cm-editor) {
  /* 覆盖 CodeMirror 样式 */
}
```

### 3. framer-motion className 兼容

framer-motion 的 `<motion.div className={...}>` 与 CSS Modules 完全兼容，className 用法不变。

### 4. 高对比度主题特殊规则

`global.css` 中保留高对比度覆盖（引用全局类名）：

```css
/* global.css 中 */
:root[data-theme='high-contrast'] :global(.btn-primary),
:root[data-theme='high-contrast'] :global(.seg-btn.active) {
  color: #000;
}
```

或者迁移后改为在对应 module 中处理：

```css
/* Button.module.css */
:root[data-theme='high-contrast'] .btnPrimary {
  color: #000;
}
```

### 5. 推荐安装 clsx

```bash
npm install clsx
```

用于简化条件类名拼接：

```jsx
import clsx from 'clsx';
import styles from './TabBar.module.css';

<div className={clsx(styles.tabItem, {
  [styles.active]: isActive,
  [styles.tabDirty]: isDirty
})} />
```

---

## 📊 预期收益

| 指标 | 迁移前 | 迁移后 |
|------|--------|--------|
| 样式文件 | 1 × 98KB | ~20 个文件，按需加载 |
| 类名冲突风险 | 高（全局命名空间） | 零（hash 隔离） |
| 死代码清除 | 无法判断 | Vite 自动 tree-shake |
| 开发调试 | 在 2100 行中搜索 | 直接打开对应 module |
| 协作冲突 | 频繁（单文件） | 极少（各组件独立） |

---

## 📅 推荐迁移顺序

1. **global.css + layout.css**（无风险，纯拆分）
2. **Sidebar.module.css**（独立性强，验证流程）
3. **TabBar.module.css**（验证动画/滚动兼容性）
4. **ResponsePanel.module.css**（最复杂，验证 CodeMirror 集成）
5. **RequestEditor.module.css**
6. 剩余组件按开发节奏逐步迁移
7. 最后删除 `src/styles.css`
