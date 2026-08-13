# P0 状态拆分：迁移说明

## 概览

本次重构将原始 `App.jsx`（~86KB / 2026 行 / 37 个 useState）拆分为 **5 个独立 Context** + 精简后的 **App 布局壳**。

### 架构对比

```
重构前：                           重构后：
┌─────────────────┐               ┌──────────────────────────────────┐
│  App.jsx        │               │  App.jsx (布局壳)                │
│  • 37 useState  │               │  ├── AppStateProvider            │
│  • ~70 handler  │               │  │   (collections/envs/history)  │
│  • 所有业务逻辑  │               │  ├── TabProvider                 │
│  • 2026 行      │               │  │   (tabs/groups/activeTab)     │
└─────────────────┘               │  ├── MockProvider                │
                                  │  │   (mock/rtState/logs)         │
                                  │  ├── UIProvider                  │
                                  │  │   (toast/modal/settings/...)  │
                                  │  ├── CookieProvider              │
                                  │  │   (cookieJar)                 │
                                  │  └── AppShell (布局 + handlers)  │
                                  └──────────────────────────────────┘
```

## 文件清单

| 文件 | 职责 | 导出 |
|------|------|------|
| `contexts/AppStateContext.jsx` | 核心业务数据（集合/环境/历史/全局变量） | `AppStateProvider`, `useAppState`, `useAppDispatch`, `APP_ACTIONS` |
| `contexts/TabContext.jsx` | 标签页 + 分组管理 | `TabProvider`, `useTabState`, `useTabDispatch`, `TAB_ACTIONS`, `createTab`, `newRequest`, `isBlankRequest`, `usePatchTab` |
| `contexts/MockContext.jsx` | Mock 服务 + WS/SSE 实时状态 | `MockProvider`, `useMockState`, `useMockDispatch`, `MOCK_ACTIONS`, `newMockRoute` |
| `contexts/UIContext.jsx` | UI 层面状态（弹窗/通知/控制台/设置/更新） | `UIProvider`, `useUIState`, `useUIDispatch`, `UI_ACTIONS`, `useToast`, `usePushNotice`, `useChangeSettings` |
| `contexts/CookieContext.jsx` | Cookie jar 独立管理 | `CookieProvider`, `useCookieState`, `useCookieDispatch`, `COOKIE_ACTIONS`, `useUpsertCookies` |
| `App.refactored.jsx` | 精简后的顶层组件（Provider 组装 + 布局骨架） | `default App` |

## 迁移步骤

### 1. 复制 Context 文件

```bash
# 在 src/ 下创建 contexts/ 目录
mkdir -p src/contexts

# 复制 5 个 Context 文件
cp contexts/AppStateContext.jsx  src/contexts/
cp contexts/TabContext.jsx       src/contexts/
cp contexts/MockContext.jsx      src/contexts/
cp contexts/UIContext.jsx        src/contexts/
cp contexts/CookieContext.jsx    src/contexts/
```

### 2. 替换 App.jsx

```bash
# 备份原文件
mv src/App.jsx src/App.jsx.bak

# 使用重构后的版本
cp App.refactored.jsx src/App.jsx
```

### 3. 验证导入路径

重构后的 `App.jsx` 中 import 路径假设目录结构为：

```
src/
├── App.jsx                    ← 新的精简版
├── contexts/
│   ├── AppStateContext.jsx
│   ├── TabContext.jsx
│   ├── MockContext.jsx
│   ├── UIContext.jsx
│   └── CookieContext.jsx
├── components/
│   └── ...（无需修改）
└── utils/
    └── ...（无需修改）
```

### 4. 子组件消费方式迁移（渐进式）

**本次重构是向后兼容的**——`AppShell` 仍然通过 props 向子组件传递数据，因此所有子组件无需立即修改。

后续可逐步将子组件从 props 接收改为直接消费 Context：

```jsx
// 之前（props drilling）：
function MyComponent({ settings, onToast, collections }) { ... }

// 之后（直接消费 Context）：
import { useUIState, useToast } from '../contexts/UIContext.jsx';
import { useAppState } from '../contexts/AppStateContext.jsx';

function MyComponent() {
  const { settings } = useUIState();
  const { collections } = useAppState();
  const showToast = useToast();
  // ...
}
```

### 5. 运行测试

```bash
npm run dev          # 开发模式验证页面渲染正常
npm run test         # 如有单元测试
npm run build        # 打包验证无编译错误
```

## Context 职责划分规则

| Context | 包含的状态 | 更新频率 | 消费者 |
|---------|-----------|---------|--------|
| AppState | collections, environments, activeEnvId, history, globals | 中（用户操作触发） | Sidebar、RequestEditor、Runner |
| Tab | tabs, activeTabId, tabGroups | 高（每次切换/编辑） | TabBar、RequestEditor、ResponsePanel |
| Mock | mock, mockRunning, mockBusy, mockLogs, selectedRouteId, rtState | 低~中 | MockPanel、WsPanel、SsePanel、StatusBar |
| UI | toast, notices, modal, prompt, confirm, settings, console*, kbd, version, update | 高（UI 交互） | 几乎所有组件（settings）、Toast、Modal |
| Cookie | cookieJar | 低 | CookiePanel、请求管线 |

## 设计决策说明

### 为什么使用 useReducer 而非 useState？

1. **可预测性**：所有状态变更通过 action 描述，便于调试（配合 React DevTools）
2. **批量更新**：一个 dispatch 可同时更新多个相关字段（如删除环境时同步 activeEnvId）
3. **可测试性**：reducer 是纯函数，可独立单元测试
4. **扩展性**：后续添加 undo/redo、中间件、日志等机制无需重写

### 为什么分成 5 个 Context 而非 1 个？

React Context 的粒度直接影响重渲染范围：

- 如果只有 1 个 Context，任何状态变化（如 toast 显示）都会导致所有消费者重渲染
- 拆分为 5 个后，修改 Mock 状态不会触发 Cookie 面板重渲染；更新 toast 不会触发标签栏重渲染
- 每个 Context 内部进一步使用 `useMemo` 缓存派生值

### 为什么保留 AppShell 中的 handler 函数？

本次为 **P0 阶段**，目标是拆分状态而非重写全部业务逻辑。Handler 函数往往需要跨多个 Context 协调（如 `doSend` 需要读 AppState、写 Tab、写 Cookie、写 UI），这些交叉逻辑适合后续进一步拆分为自定义 Hook（P1 阶段）。

## 后续优化方向（P1/P2）

### P1：自定义 Hook 拆分

将 `AppShell` 中的 handler 按领域拆分为独立 Hook：

```
hooks/
├── useRequestSend.js      // doSend, handleSend, handleRetryNoSsl, handleCancelSend
├── useCollectionOps.js    // handleNewCollection, handleAddFolder, handleRename, etc.
├── useTabOps.js           // handleNewTab, handleCloseTab, handleCycleTab, etc.
├── useMockOps.js          // handleMockToggle, handleAddRoute, etc.
├── useImportExport.js     // handleImport, handleExport*, handleBackup, etc.
└── usePersistence.js      // 去抖保存逻辑
```

### P2：子组件直接消费 Context

移除子组件的 prop drilling，改为在组件内部直接 `useXxxState()`。这将：
- 减少 `AppShell` 的 props 列表（当前仍传递 40+ props 给 Sidebar）
- 让子组件声明式地描述自己的数据依赖
- 进一步减少不必要的重渲染

### P3：性能优化

- 对高频更新的 Context（如 Tab、UI）使用 `useRef` + `useSyncExternalStore` 替代
- 引入 selector 模式（类似 zustand 的 `useStore(selector)`）进一步细化订阅粒度
- 将 `executeRequest` 等重型异步逻辑移入 Web Worker

## 常见问题

### Q: 原来通过 props 传入的 `showToast` 怎么办？

子组件可以继续接收 props 中的 `onToast`（兼容模式），也可以直接：
```jsx
import { useToast } from '../contexts/UIContext.jsx';
const showToast = useToast();
```

### Q: 需要同时修改多个 Context 的状态怎么办？

在 handler 中依次 dispatch 到不同 Context 即可——React 18 会自动批处理（automatic batching），不会造成多次重渲染：
```jsx
appDispatch({ type: APP_ACTIONS.HYDRATE, payload: { ... } });
mockDispatch({ type: MOCK_ACTIONS.SET_MOCK, payload: mock });
cookieDispatch({ type: COOKIE_ACTIONS.SET_JAR, payload: jar });
// 以上三个 dispatch 在同一个事件/effect 中会被批处理为一次渲染
```

### Q: 如何为 reducer 编写单元测试？

```jsx
import { appStateReducer, initialAppState, APP_ACTIONS } from './contexts/AppStateContext';

test('ADD_COLLECTION 应追加新集合', () => {
  const state = appStateReducer(initialAppState, {
    type: APP_ACTIONS.ADD_COLLECTION,
    payload: { id: '123', name: '测试集合', folders: [], requests: [] }
  });
  expect(state.collections).toHaveLength(2); // 默认 + 新增
  expect(state.collections[1].name).toBe('测试集合');
});
```

---

**迁移完成后删除 `App.jsx.bak` 即可。** 🎉
