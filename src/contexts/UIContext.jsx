/**
 * UIContext — UI 层面状态管理
 * 管理：toast, notices, noticeUnread, noticesOpen, modal, prompt, confirm,
 *       paletteOpen, consoleOpen, consoleLogs, scriptLogs, kbdOpen,
 *       settings, appVersion, updateProgress
 *
 * 这些状态控制 UI 表层：弹窗、通知、控制台日志、设置面板等。
 * 大部分组件只需要读取 settings，少部分需要触发 toast/modal。
 */
import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { normalizeSettings, applyTheme } from '../utils/themeUtil.js';

// ---- 工具函数 ----
function uuid() {
  return crypto.randomUUID();
}

// ---- Action Types ----
export const UI_ACTIONS = {
  // Toast
  SHOW_TOAST: 'SHOW_TOAST',
  HIDE_TOAST: 'HIDE_TOAST',
  // 通知中心
  PUSH_NOTICE: 'PUSH_NOTICE',
  CLEAR_NOTICES: 'CLEAR_NOTICES',
  SET_NOTICE_UNREAD: 'SET_NOTICE_UNREAD',
  TOGGLE_NOTICES: 'TOGGLE_NOTICES',
  SET_NOTICES_OPEN: 'SET_NOTICES_OPEN',
  // 弹窗系统
  SET_MODAL: 'SET_MODAL',
  SET_PROMPT: 'SET_PROMPT',
  SET_CONFIRM: 'SET_CONFIRM',
  // 面板开关
  SET_PALETTE_OPEN: 'SET_PALETTE_OPEN',
  SET_CONSOLE_OPEN: 'SET_CONSOLE_OPEN',
  SET_KBD_OPEN: 'SET_KBD_OPEN',
  // 控制台日志
  ADD_CONSOLE_LOG: 'ADD_CONSOLE_LOG',
  CLEAR_CONSOLE_LOGS: 'CLEAR_CONSOLE_LOGS',
  ADD_SCRIPT_LOGS: 'ADD_SCRIPT_LOGS',
  CLEAR_SCRIPT_LOGS: 'CLEAR_SCRIPT_LOGS',
  // 设置
  CHANGE_SETTINGS: 'CHANGE_SETTINGS',
  SET_SETTINGS: 'SET_SETTINGS',
  // 版本 & 更新
  SET_APP_VERSION: 'SET_APP_VERSION',
  SET_UPDATE_PROGRESS: 'SET_UPDATE_PROGRESS',
};

// ---- Initial State ----
export const initialUIState = {
  toast: null,
  notices: [],
  noticeUnread: 0,
  noticesOpen: false,
  modal: null,
  prompt: null,
  confirm: null,
  paletteOpen: false,
  consoleOpen: false,
  consoleLogs: [],
  scriptLogs: [],
  kbdOpen: false,
  settings: normalizeSettings(null),
  appVersion: '',
  updateProgress: null,
};

// ---- Reducer ----
export function uiReducer(state, action) {
  switch (action.type) {
    // ---- Toast ----
    case UI_ACTIONS.SHOW_TOAST:
      return { ...state, toast: action.payload };

    case UI_ACTIONS.HIDE_TOAST:
      return { ...state, toast: null };

    // ---- 通知中心 ----
    case UI_ACTIONS.PUSH_NOTICE:
      return {
        ...state,
        notices: [
          { id: uuid(), time: new Date().toISOString(), ...action.payload },
          ...state.notices,
        ].slice(0, 100),
        noticeUnread: state.noticeUnread + 1,
      };

    case UI_ACTIONS.CLEAR_NOTICES:
      return { ...state, notices: [], noticeUnread: 0 };

    case UI_ACTIONS.SET_NOTICE_UNREAD:
      return { ...state, noticeUnread: action.payload };

    case UI_ACTIONS.TOGGLE_NOTICES:
      return {
        ...state,
        noticesOpen: !state.noticesOpen,
        noticeUnread: state.noticesOpen ? state.noticeUnread : 0,
      };

    case UI_ACTIONS.SET_NOTICES_OPEN:
      return { ...state, noticesOpen: action.payload };

    // ---- 弹窗系统 ----
    case UI_ACTIONS.SET_MODAL:
      return { ...state, modal: action.payload };

    case UI_ACTIONS.SET_PROMPT:
      return { ...state, prompt: action.payload };

    case UI_ACTIONS.SET_CONFIRM:
      return { ...state, confirm: action.payload };

    // ---- 面板开关 ----
    case UI_ACTIONS.SET_PALETTE_OPEN:
      return { ...state, paletteOpen: action.payload };

    case UI_ACTIONS.SET_CONSOLE_OPEN:
      return { ...state, consoleOpen: action.payload };

    case UI_ACTIONS.SET_KBD_OPEN:
      return { ...state, kbdOpen: action.payload };

    // ---- 控制台日志 ----
    case UI_ACTIONS.ADD_CONSOLE_LOG:
      return {
        ...state,
        consoleLogs: [action.payload, ...state.consoleLogs].slice(0, 200),
      };

    case UI_ACTIONS.CLEAR_CONSOLE_LOGS:
      return { ...state, consoleLogs: [] };

    case UI_ACTIONS.ADD_SCRIPT_LOGS:
      return {
        ...state,
        scriptLogs: [...action.payload, ...state.scriptLogs].slice(0, 300),
      };

    case UI_ACTIONS.CLEAR_SCRIPT_LOGS:
      return { ...state, scriptLogs: [] };

    // ---- 设置 ----
    case UI_ACTIONS.CHANGE_SETTINGS: {
      const next = normalizeSettings({ ...state.settings, ...action.payload });
      applyTheme(next);
      return { ...state, settings: next };
    }

    case UI_ACTIONS.SET_SETTINGS: {
      const next = normalizeSettings(action.payload);
      applyTheme(next);
      return { ...state, settings: next };
    }

    // ---- 版本 & 更新 ----
    case UI_ACTIONS.SET_APP_VERSION:
      return { ...state, appVersion: action.payload };

    case UI_ACTIONS.SET_UPDATE_PROGRESS:
      return { ...state, updateProgress: action.payload };

    default:
      return state;
  }
}

// ---- Context ----
const UIStateContext = createContext(null);
const UIDispatchContext = createContext(null);

/** UIProvider：包裹应用顶层，管理 UI 层面状态 */
export function UIProvider({ children }) {
  const [state, dispatch] = useReducer(uiReducer, initialUIState);

  const contextValue = useMemo(() => state, [state]);

  return (
    <UIStateContext.Provider value={contextValue}>
      <UIDispatchContext.Provider value={dispatch}>
        {children}
      </UIDispatchContext.Provider>
    </UIStateContext.Provider>
  );
}

/** 读取 UI 状态 */
export function useUIState() {
  const ctx = useContext(UIStateContext);
  if (!ctx) throw new Error('useUIState 必须在 UIProvider 内使用');
  return ctx;
}

/** 获取 UI dispatch 函数 */
export function useUIDispatch() {
  const dispatch = useContext(UIDispatchContext);
  if (!dispatch) throw new Error('useUIDispatch 必须在 UIProvider 内使用');
  return dispatch;
}

// ---- 高频便捷 Hooks ----

/** 显示 toast 通知（同时记入通知中心） */
export function useToast() {
  const dispatch = useUIDispatch();
  return useCallback((text, type = 'info') => {
    dispatch({ type: UI_ACTIONS.SHOW_TOAST, payload: { text, type } });
    setTimeout(() => dispatch({ type: UI_ACTIONS.HIDE_TOAST }), 2500);
    dispatch({ type: UI_ACTIONS.PUSH_NOTICE, payload: { text, type } });
  }, [dispatch]);
}

/** 仅记录到通知中心（不弹 toast） */
export function usePushNotice() {
  const dispatch = useUIDispatch();
  return useCallback((text, type = 'info') => {
    dispatch({ type: UI_ACTIONS.PUSH_NOTICE, payload: { text, type } });
  }, [dispatch]);
}

/** 修改设置（支持主题切换平滑过渡） */
export function useChangeSettings() {
  const dispatch = useUIDispatch();
  const { settings } = useUIState();
  return useCallback((patch) => {
    // 主题/强调色变化时给根元素短暂挂上过渡类，颜色平滑切换不闪变
    const colorChange = ('theme' in patch && patch.theme !== settings.theme) ||
                        ('accent' in patch && patch.accent !== settings.accent);
    if (colorChange) {
      document.documentElement.classList.add('theme-switching');
      clearTimeout(useChangeSettings._tt);
      useChangeSettings._tt = setTimeout(
        () => document.documentElement.classList.remove('theme-switching'), 250
      );
    }
    dispatch({ type: UI_ACTIONS.CHANGE_SETTINGS, payload: patch });
  }, [dispatch, settings]);
}
