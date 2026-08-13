# Store 数据迁移框架

## 概述

本模块为 `Store` 添加了版本号管理和自动数据迁移能力。当数据结构发生变化（新增字段、重命名、删除等），只需编写迁移函数即可实现平滑升级，无需用户手动处理。

## 文件结构

```
electron/
├── store.cjs        # Store 核心类（带版本号 + 迁移逻辑）
└── migrations.cjs   # 迁移函数注册表 + CURRENT_VERSION
```

## 工作原理

### 保存时

```
save(state) → 自动注入 { ...state, __version: CURRENT_VERSION } → 写入文件
```

### 加载时

```
load() → 读取文件 → 检查 __version
  ├─ __version === CURRENT_VERSION → 直接返回
  ├─ __version < CURRENT_VERSION  → 执行迁移链 → 自动回写
  └─ __version 不存在            → 视为 v1，执行完整迁移链
```

### 迁移链

迁移按版本号顺序执行：`v1→v2→v3→...→vN`

```
migrations[0] = v1→v2 的迁移函数
migrations[1] = v2→v3 的迁移函数
migrations[N-2] = v(N-1)→vN 的迁移函数
```

### 安全机制

- **迁移前自动备份**：备份为 `{filePath}.bak.{timestamp}`
- **迁移失败不阻塞**：捕获异常，返回当前能到达的最新版本数据
- **写入原子化**：先写 `.tmp` 文件再 `rename`，防止写半截

## 如何添加新迁移

### 第 1 步：更新版本号

打开 `migrations.cjs`，将 `CURRENT_VERSION` 加 1：

```javascript
// 原来
const CURRENT_VERSION = 2;
// 改为
const CURRENT_VERSION = 3;
```

### 第 2 步：编写迁移函数

在 `migrations` 数组末尾添加迁移函数：

```javascript
const migrations = [
  // v1 → v2（已有）
  (state) => { ... },

  // v2 → v3（新增）
  (state) => {
    // 示例：添加 recentFiles 数组
    if (!Array.isArray(state.recentFiles)) {
      state.recentFiles = [];
    }
    // 示例：将 state.settings.theme 的 'dark' 重命名为 'dark-mode'
    if (state.settings?.theme === 'dark') {
      state.settings.theme = 'dark-mode';
    }
    return state;
  },
];
```

### 迁移函数规范

| 规则 | 说明 |
|------|------|
| 接收参数 | `(state)` — 上一版本的数据对象 |
| 返回值 | 必须返回修改后的 `state` |
| 不要修改 `__version` | Store 会自动处理版本号 |
| 幂等性 | 建议用 `if (x === undefined)` 守卫，防止重复执行出错 |
| 抛异常 = 失败 | 如果迁移逻辑出错，直接 `throw`，Store 会备份并降级 |

## 使用示例

```javascript
const { Store } = require('./store.cjs');

// 创建 Store 实例（verbose 模式打印迁移日志）
const store = new Store('/path/to/data.json', { verbose: true });

// 加载（自动迁移）
const state = store.load();

// 保存（自动注入 __version）
store.save({ settings: { theme: 'dark' }, items: [] });
```

## 数据文件格式

保存后的 JSON 文件示例：

```json
{
  "settings": {
    "theme": "system"
  },
  "items": [],
  "__version": 2
}
```

## 故障恢复

如果迁移出问题，找到备份文件（与数据文件同目录）：

```
data.json.bak.1691234567890
```

将其重命名为原文件名即可回退：

```bash
mv data.json.bak.1691234567890 data.json
```

## 与原版的兼容性

- 原版保存的文件没有 `__version` 字段 → 自动视为 v1
- 新版 Store 是原版的超集，API 签名完全一致（`load()` / `save(state)`）
- 唯一变化：构造函数新增可选 `options` 参数
