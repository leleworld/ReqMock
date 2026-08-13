/**
 * CookieContext — Cookie 罐状态管理
 * 管理：cookieJar
 *
 * Cookie jar 是独立于请求编辑和 Mock 的数据子集：
 * - 请求发送后如果开启了 Cookie，会自动合入 Set-Cookie 响应头
 * - Cookie 面板允许手动查看、编辑、删除
 * - 持久化到 store
 *
 * 由于 cookieJar 被多个系统（请求管线、Runner、面板）读写，
 * 拆分为独立 Context 使各消费者不因其他状态变化而无谓重渲染。
 */
import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { upsertCookies, pruneCookies } from '../utils/cookieUtil.js';

// ---- Action Types ----
export const COOKIE_ACTIONS = {
  SET_JAR: 'SET_JAR',
  UPSERT_COOKIES: 'UPSERT_COOKIES',
  DELETE_COOKIE: 'DELETE_COOKIE',
  CLEAR_DOMAIN: 'CLEAR_DOMAIN',
  CLEAR_ALL: 'CLEAR_ALL',
  PRUNE: 'PRUNE',
};

// ---- Initial State ----
export const initialCookieState = {
  cookieJar: [],
};

// ---- Reducer ----
export function cookieReducer(state, action) {
  switch (action.type) {
    case COOKIE_ACTIONS.SET_JAR:
      return { ...state, cookieJar: action.payload };

    case COOKIE_ACTIONS.UPSERT_COOKIES: {
      const { cookies, url } = action.payload;
      return {
        ...state,
        cookieJar: upsertCookies(state.cookieJar, cookies, url),
      };
    }

    case COOKIE_ACTIONS.DELETE_COOKIE:
      return {
        ...state,
        cookieJar: state.cookieJar.filter(
          (c) => !(c.name === action.payload.name && c.domain === action.payload.domain && c.path === action.payload.path)
        ),
      };

    case COOKIE_ACTIONS.CLEAR_DOMAIN:
      return {
        ...state,
        cookieJar: state.cookieJar.filter((c) => c.domain !== action.payload),
      };

    case COOKIE_ACTIONS.CLEAR_ALL:
      return { ...state, cookieJar: [] };

    case COOKIE_ACTIONS.PRUNE:
      return { ...state, cookieJar: pruneCookies(state.cookieJar) };

    default:
      return state;
  }
}

// ---- Context ----
const CookieStateContext = createContext(null);
const CookieDispatchContext = createContext(null);

/** CookieProvider：包裹应用顶层，管理 Cookie jar */
export function CookieProvider({ children }) {
  const [state, dispatch] = useReducer(cookieReducer, initialCookieState);

  const contextValue = useMemo(() => state, [state]);

  return (
    <CookieStateContext.Provider value={contextValue}>
      <CookieDispatchContext.Provider value={dispatch}>
        {children}
      </CookieDispatchContext.Provider>
    </CookieStateContext.Provider>
  );
}

/** 读取 Cookie jar */
export function useCookieState() {
  const ctx = useContext(CookieStateContext);
  if (!ctx) throw new Error('useCookieState 必须在 CookieProvider 内使用');
  return ctx;
}

/** 获取 Cookie dispatch 函数 */
export function useCookieDispatch() {
  const dispatch = useContext(CookieDispatchContext);
  if (!dispatch) throw new Error('useCookieDispatch 必须在 CookieProvider 内使用');
  return dispatch;
}

/** 便捷 hook：向 Cookie jar 插入/更新 Set-Cookie 响应头解析出的 cookie */
export function useUpsertCookies() {
  const dispatch = useCookieDispatch();
  return useCallback((cookies, url) => {
    dispatch({ type: COOKIE_ACTIONS.UPSERT_COOKIES, payload: { cookies, url } });
  }, [dispatch]);
}
