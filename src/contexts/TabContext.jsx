/**
 * TabContext — 标签页状态管理
 * 管理：tabs, activeTabId, tabGroups, dismissedGroupKeys
 *
 * 标签页是工作区的核心导航机制，包括请求标签、页面标签（环境/Cookie/Mock/工具等）、
 * WebSocket/SSE 连接标签。标签分组为 Chrome 风格的可折叠分组。
 */
import React, { createContext, useContext, useReducer, useCallback, useMemo, useRef } from 'react';
import { normalizeRequest } from '../utils/collectionUtil.js';
import { normalizeOpenedRequest } from '../utils/urlSync.js';
import { applyAutoGroups, pickGroupColor, reorderTabsByGroup } from '../utils/tabGroupUtil.js';

// ---- 工具函数 ----
function uuid() {
  return crypto.randomUUID();
}

export function newRequest() {
  return normalizeRequest({ id: uuid() });
}

/** 新建一个请求标签页（每个标签独立持有请求/响应/脚本结果/发送状态） */
export function createTab(request) {
  return { id: uuid(), kind: 'request', request, response: null, scriptResult: null, sending: false };
}

/** 判断是否为未编辑过的空白请求，打开请求时可直接复用该标签 */
export function isBlankRequest(req) {
  return !req.url && req.bodyType === 'none' && !req.body &&
    (req.params || []).length === 0 && (req.headers || []).length === 0 &&
    (!req.name || req.name === '未命名请求');
}

// ---- Action Types ----
export const TAB_ACTIONS = {
  // 整体设置
  HYDRATE_TABS: 'HYDRATE_TABS',
  SET_TABS: 'SET_TABS',
  SET_ACTIVE_TAB: 'SET_ACTIVE_TAB',
  // 单标签操作
  ADD_TAB: 'ADD_TAB',
  CLOSE_TAB: 'CLOSE_TAB',
  PATCH_TAB: 'PATCH_TAB',
  // 分组操作
  SET_TAB_GROUPS: 'SET_TAB_GROUPS',
  ADD_GROUP: 'ADD_GROUP',
  UPDATE_GROUP: 'UPDATE_GROUP',
  REMOVE_GROUP: 'REMOVE_GROUP',
  ASSIGN_GROUP: 'ASSIGN_GROUP',
  LEAVE_GROUP: 'LEAVE_GROUP',
  UNGROUP: 'UNGROUP',
  CLOSE_GROUP: 'CLOSE_GROUP',
  // 自动分组结果应用
  APPLY_AUTO_GROUPS: 'APPLY_AUTO_GROUPS',
  // 固定
  TOGGLE_PIN_TAB: 'TOGGLE_PIN_TAB',
  TOGGLE_PIN_GROUP: 'TOGGLE_PIN_GROUP',
};

// ---- Initial State ----
export const initialTabState = {
  tabs: [createTab(newRequest())],
  activeTabId: null,
  tabGroups: [],
};

// ---- Reducer ----
export function tabReducer(state, action) {
  switch (action.type) {
    case TAB_ACTIONS.HYDRATE_TABS:
      return {
        ...state,
        tabs: action.payload.tabs,
        activeTabId: action.payload.activeTabId,
        tabGroups: action.payload.tabGroups || [],
      };

    case TAB_ACTIONS.SET_TABS:
      return { ...state, tabs: action.payload };

    case TAB_ACTIONS.SET_ACTIVE_TAB:
      return { ...state, activeTabId: action.payload };

    case TAB_ACTIONS.ADD_TAB: {
      const { tab, activate = true } = action.payload;
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: activate ? tab.id : state.activeTabId,
      };
    }

    case TAB_ACTIONS.CLOSE_TAB: {
      const tabId = action.payload;
      const next = state.tabs.filter((t) => t.id !== tabId);
      if (next.length === 0) {
        // 关闭最后一个标签时自动新建空白标签
        const tab = createTab(newRequest());
        return { ...state, tabs: [tab], activeTabId: tab.id };
      }
      let activeTabId = state.activeTabId;
      if (tabId === state.activeTabId) {
        const idx = state.tabs.findIndex((t) => t.id === tabId);
        activeTabId = next[Math.max(0, idx - 1)].id;
      }
      return { ...state, tabs: next, activeTabId };
    }

    case TAB_ACTIONS.PATCH_TAB:
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.payload.tabId ? { ...t, ...action.payload.patch } : t
        ),
      };

    // ---- 分组操作 ----
    case TAB_ACTIONS.SET_TAB_GROUPS:
      return { ...state, tabGroups: action.payload };

    case TAB_ACTIONS.ADD_GROUP: {
      const { group, tabId } = action.payload;
      return {
        ...state,
        tabGroups: [...state.tabGroups, group],
        tabs: reorderTabsByGroup(
          state.tabs.map((t) => (t.id === tabId ? { ...t, groupId: group.id } : t))
        ),
      };
    }

    case TAB_ACTIONS.UPDATE_GROUP:
      return {
        ...state,
        tabGroups: state.tabGroups.map((g) =>
          g.id === action.payload.groupId ? { ...g, ...action.payload.patch } : g
        ),
      };

    case TAB_ACTIONS.REMOVE_GROUP:
      return {
        ...state,
        tabGroups: state.tabGroups.filter((g) => g.id !== action.payload),
      };

    case TAB_ACTIONS.ASSIGN_GROUP: {
      const { tabId, groupId } = action.payload;
      return {
        ...state,
        tabGroups: state.tabGroups.map((g) =>
          g.id === groupId
            ? { ...g, auto: false, excludedTabIds: (g.excludedTabIds || []).filter((id) => id !== tabId) }
            : g
        ),
        tabs: reorderTabsByGroup(
          state.tabs.map((t) => (t.id === tabId ? { ...t, groupId } : t))
        ),
      };
    }

    case TAB_ACTIONS.LEAVE_GROUP: {
      const tabId = action.payload;
      const tab = state.tabs.find((t) => t.id === tabId);
      const groupId = tab && tab.groupId;
      return {
        ...state,
        tabGroups: groupId
          ? state.tabGroups.map((g) =>
              g.id === groupId
                ? { ...g, excludedTabIds: [...new Set([...(g.excludedTabIds || []), tabId])] }
                : g
            )
          : state.tabGroups,
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, groupId: undefined } : t)),
      };
    }

    case TAB_ACTIONS.UNGROUP: {
      const groupId = action.payload;
      return {
        ...state,
        tabGroups: state.tabGroups.filter((g) => g.id !== groupId),
        tabs: state.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)),
      };
    }

    case TAB_ACTIONS.CLOSE_GROUP: {
      const groupId = action.payload;
      const next = state.tabs.filter((t) => t.groupId !== groupId);
      if (next.length === 0) {
        const tab = createTab(newRequest());
        return {
          ...state,
          tabGroups: state.tabGroups.filter((g) => g.id !== groupId),
          tabs: [tab],
          activeTabId: tab.id,
        };
      }
      return {
        ...state,
        tabGroups: state.tabGroups.filter((g) => g.id !== groupId),
        tabs: next,
        activeTabId: next.some((t) => t.id === state.activeTabId)
          ? state.activeTabId
          : next[0].id,
      };
    }

    case TAB_ACTIONS.APPLY_AUTO_GROUPS:
      return {
        ...state,
        tabs: action.payload.tabs,
        tabGroups: action.payload.groups,
      };

    case TAB_ACTIONS.TOGGLE_PIN_TAB:
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.payload ? { ...t, pinned: !t.pinned } : t)),
      };

    case TAB_ACTIONS.TOGGLE_PIN_GROUP:
      return {
        ...state,
        tabGroups: state.tabGroups.map((g) =>
          g.id === action.payload ? { ...g, pinned: !g.pinned } : g
        ),
      };

    default:
      return state;
  }
}

// ---- Context ----
const TabStateContext = createContext(null);
const TabDispatchContext = createContext(null);

/** TabProvider：包裹应用顶层，管理标签页和分组状态 */
export function TabProvider({ children }) {
  const [state, dispatch] = useReducer(tabReducer, initialTabState);

  // 用户主动解散过的自动分组 urlKey，会话内不再自动重建
  const dismissedGroupKeysRef = useRef(new Set());

  // 当前激活标签页（高频访问，缓存计算结果）
  const curTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0],
    [state.tabs, state.activeTabId]
  );

  const contextValue = useMemo(
    () => ({
      ...state,
      curTab,
      dismissedGroupKeysRef,
    }),
    [state, curTab]
  );

  return (
    <TabStateContext.Provider value={contextValue}>
      <TabDispatchContext.Provider value={dispatch}>
        {children}
      </TabDispatchContext.Provider>
    </TabStateContext.Provider>
  );
}

/** 读取标签页状态（tabs, activeTabId, tabGroups, curTab） */
export function useTabState() {
  const ctx = useContext(TabStateContext);
  if (!ctx) throw new Error('useTabState 必须在 TabProvider 内使用');
  return ctx;
}

/** 获取标签页 dispatch 函数以分发 TAB_ACTIONS */
export function useTabDispatch() {
  const dispatch = useContext(TabDispatchContext);
  if (!dispatch) throw new Error('useTabDispatch 必须在 TabProvider 内使用');
  return dispatch;
}

/** 便捷 hook：更新指定标签的部分字段 */
export function usePatchTab() {
  const dispatch = useTabDispatch();
  return useCallback((tabId, patch) => {
    dispatch({ type: TAB_ACTIONS.PATCH_TAB, payload: { tabId, patch } });
  }, [dispatch]);
}
