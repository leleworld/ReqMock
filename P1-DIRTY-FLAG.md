# P1 — Dirty Flag & 持久化优化 补丁说明

## 问题总结

| 问题 | 影响 |
|------|------|
| `isTabDirty` 使用 `JSON.stringify` 对比 | 每次 `collections` 变化，对所有标签做全量序列化 → O(n×m) |
| 持久化 `useEffect` 依赖 13+ 个 state | 任何微小变化（打字、切标签）都 `clearTimeout` + `setTimeout` 重建 |
| `saveStore` 在 `setTimeout` 闭包中捕获全量 state | 闭包频繁刷新，GC 压力 |

---

## 文件清单

```
src/hooks/dirtyFlag.js      ← 新增：dirty flag hook
src/hooks/persistenceHook.js ← 新增：持久化 hook
src/App.jsx                  ← 修改：集成上述 hook
```

---

## 一、集成 dirtyFlag.js

### 1. 将文件放入 `src/hooks/dirtyFlag.js`

### 2. 在 App.jsx 中引入并使用

```diff
+ import { useDirtyFlag } from './hooks/dirtyFlag.js';

  export default function App() {
    // ...existing state...

+   // ---- dirty flag：替代 JSON.stringify 对比 ----
+   const { isTabDirty, markTabClean, removeDirtyEntry, makePatchTabWithDirty } = useDirtyFlag(isBlankRequest);

    const [tabs, setTabs] = useState(() => [createTab(newRequest())]);

-   const patchTab = useCallback((tabId, patch) => {
-     setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
-   }, []);
+   // patchTab 增强：修改 request 时自动标脏
+   const patchTab = useMemo(() => makePatchTabWithDirty(setTabs), [makePatchTabWithDirty]);
```

### 3. 删除旧的 isTabDirty

```diff
-  /** 请求标签是否有未保存改动：与集合中已存版本对比；未入集合的非空白请求也视为未保存 */
-  const isTabDirty = useCallback((tab) => {
-    if (!tab || tab.kind !== 'request') return false;
-    const saved = findRequestById(collections, tab.request.id);
-    if (saved) return JSON.stringify(normalizeRequest(saved)) !== JSON.stringify(normalizeRequest(tab.request));
-    return !isBlankRequest(tab.request);
-  }, [collections]);
```

> 新版 `isTabDirty` 由 hook 提供，不再依赖 `collections`。

### 4. 保存成功后清除 dirty

在"保存请求"逻辑（`handleSaveRequest` 或保存弹窗确认回调）结尾添加：

```js
markTabClean(curTab.id);
```

### 5. 关闭标签时释放内存

在 `closeTab`/`handleCloseTab` 中添加：

```js
removeDirtyEntry(tabId);
```

### 6. 打开已有请求时标记来源

在 `openRequest`（从集合中打开一个请求到标签页）时，给 tab 添加 `_savedId`：

```js
const tab = { ...createTab(req), _savedId: req.id };
```

这使 `isTabDirty` 对"从集合打开但未修改"的标签正确返回 `false`。

---

## 二、集成 persistenceHook.js

### 1. 将文件放入 `src/hooks/persistenceHook.js`

### 2. 在 App.jsx 中使用

```diff
+ import { usePersistence } from './hooks/persistenceHook.js';

  export default function App() {
    // ...existing state...

+   // ---- 持久化：用 ref 快照 + 脏标记，避免 timer 重建 ----
+   const stateRef = useRef(null);
+   // 每次渲染时更新快照（ref 赋值不触发 re-render）
+   stateRef.current = {
+     collections, environments, activeEnvId, history, mock,
+     cookieJar, globals, settings, tabs, tabGroups, activeTabId: curTab.id
+   };
+
+   const getSnapshot = useCallback(() => {
+     const s = stateRef.current;
+     return {
+       ...s,
+       openTabs: s.tabs.map((t) => (
+         t.kind === 'request'
+           ? { id: t.id, kind: 'request', request: t.request, groupId: t.groupId }
+           : { id: t.id, kind: t.kind, envId: t.envId, tool: t.tool, nodeId: t.nodeId, config: t.config, groupId: t.groupId }
+       )),
+       tabGroups: s.tabGroups,
+       activeTabId: s.activeTabId
+     };
+   }, []);
+
+   const { markPersistDirty } = usePersistence({
+     loaded,
+     getSnapshot,
+     saveStore: window.api.saveStore
+   });
```

### 3. 删除旧的持久化 useEffect

```diff
-  // ---- 状态变化去抖持久化 ----
-  const saveTimer = useRef(null);
-  useEffect(() => {
-    if (!loaded) return;
-    clearTimeout(saveTimer.current);
-    saveTimer.current = setTimeout(() => {
-      window.api.saveStore({
-        collections, environments, activeEnvId, history, mock,
-        cookieJar, globals, settings,
-        openTabs: tabs.map((t) => ( ... )),
-        tabGroups,
-        activeTabId: curTab.id
-      });
-    }, 800);
-    return () => clearTimeout(saveTimer.current);
-  }, [loaded, collections, environments, activeEnvId, history, mock, cookieJar, globals, settings, tabs, tabGroups, activeTabId]);
```

### 4. 在所有 state 变更处调用 markPersistDirty

**最小改动方案**：在每个会改变持久化 state 的 setter 调用后加一行。
推荐使用包装函数减少遗漏：

```js
// 包装 setter：修改后自动标记需要持久化
const setCollectionsP = useCallback((v) => { setCollections(v); markPersistDirty(); }, [markPersistDirty]);
const setEnvironmentsP = useCallback((v) => { setEnvironments(v); markPersistDirty(); }, [markPersistDirty]);
const setActiveEnvIdP = useCallback((v) => { setActiveEnvId(v); markPersistDirty(); }, [markPersistDirty]);
const setHistoryP = useCallback((v) => { setHistory(v); markPersistDirty(); }, [markPersistDirty]);
const setMockP = useCallback((v) => { setMock(v); markPersistDirty(); }, [markPersistDirty]);
const setCookieJarP = useCallback((v) => { setCookieJar(v); markPersistDirty(); }, [markPersistDirty]);
const setGlobalsP = useCallback((v) => { setGlobals(v); markPersistDirty(); }, [markPersistDirty]);
const setSettingsP = useCallback((v) => { setSettings(v); markPersistDirty(); }, [markPersistDirty]);
const setTabsP = useCallback((v) => { setTabs(v); markPersistDirty(); }, [markPersistDirty]);
const setTabGroupsP = useCallback((v) => { setTabGroups(v); markPersistDirty(); }, [markPersistDirty]);
```

然后全局替换：`setCollections(` → `setCollectionsP(`，以此类推。

> **注意**：`patchTab`（makePatchTabWithDirty 返回）内部调用的是原始 `setTabs`，
> 需要在其调用后也触发 `markPersistDirty()`。可以改为：
> ```js
> const patchTab = useCallback((tabId, patch) => {
>   setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
>   markPersistDirty();
> }, [markPersistDirty]);
> ```

---

## 三、性能对比

| 指标 | 旧方案 | 新方案 |
|------|--------|--------|
| isTabDirty 复杂度 | O(n) JSON.stringify per tab | O(1) Map.get |
| 依赖 collections 变化 | 是（每次 collections 变化触发所有 TabBar re-render） | 否 |
| 持久化 timer 重建频率 | 每次任意 state 变化 | 仅当无活跃 timer 时创建一次 |
| saveStore 闭包捕获 | 全量 state（13+ 变量） | 零捕获（通过 ref 读取） |
| 窗口关闭数据安全 | 依赖 800ms 延迟内无变化 | beforeunload 强制 flush |

---

## 四、注意事项

1. **向后兼容**：`_savedId` 仅用于 dirty 判断，不持久化到 store，不影响现有数据格式
2. **测试建议**：
   - 打开集合中已有请求 → 标签无 dot → 修改 URL → 出现 dot → 保存 → dot 消失
   - 快速连续输入 → 持久化只触发一次写入（800ms 后）
   - `Ctrl+W` 关闭浏览器 → 数据不丢失（beforeunload flush）
3. **渐进式迁移**：可以先只替换 `isTabDirty`（收益最大），持久化优化可后续跟进
