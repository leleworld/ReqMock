/**
 * AppStateContext — 核心业务数据状态
 * 管理：collections, environments, history, activeEnvId, globals
 *
 * 这些是持久化到 store 的核心数据，几乎所有面板都需要读取。
 * 拆分后其他 Context（如 TabContext）可通过 useAppState() 访问这些数据而非 prop drilling。
 */
import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import {
  newCollection, normalizeNode, updateNode, removeNode,
  findNode, upsertRequestById, removeRequestById, moveRequest,
  findRequestById, moveFolder
} from '../utils/collectionUtil.js';
import { newEnvironment, buildVarMap, mergeVariables } from '../utils/envUtil.js';
import { pruneCookies } from '../utils/cookieUtil.js';

// ---- Action Types ----
export const APP_ACTIONS = {
  // 初始化
  HYDRATE: 'HYDRATE',
  // 集合操作
  SET_COLLECTIONS: 'SET_COLLECTIONS',
  ADD_COLLECTION: 'ADD_COLLECTION',
  UPDATE_NODE: 'UPDATE_NODE',
  REMOVE_NODE: 'REMOVE_NODE',
  REMOVE_REQUEST: 'REMOVE_REQUEST',
  UPSERT_REQUEST: 'UPSERT_REQUEST',
  MOVE_REQUEST: 'MOVE_REQUEST',
  MOVE_FOLDER: 'MOVE_FOLDER',
  // 环境操作
  SET_ENVIRONMENTS: 'SET_ENVIRONMENTS',
  ADD_ENVIRONMENT: 'ADD_ENVIRONMENT',
  UPDATE_ENVIRONMENT: 'UPDATE_ENVIRONMENT',
  DELETE_ENVIRONMENT: 'DELETE_ENVIRONMENT',
  SET_ACTIVE_ENV: 'SET_ACTIVE_ENV',
  PERSIST_ENV_CHANGES: 'PERSIST_ENV_CHANGES',
  // 全局变量
  SET_GLOBALS: 'SET_GLOBALS',
  UPSERT_GLOBAL_VAR: 'UPSERT_GLOBAL_VAR',
  // 历史
  SET_HISTORY: 'SET_HISTORY',
  ADD_HISTORY: 'ADD_HISTORY',
  DELETE_HISTORY_ITEM: 'DELETE_HISTORY_ITEM',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
};

// ---- Initial State ----
const defaultCollections = [newCollection('默认集合')];

export const initialAppState = {
  collections: defaultCollections,
  environments: [],
  activeEnvId: null,
  history: [],
  globals: [],
  loaded: false,
};

// ---- Reducer ----
export function appStateReducer(state, action) {
  switch (action.type) {
    case APP_ACTIONS.HYDRATE:
      return {
        ...state,
        collections: action.payload.collections || state.collections,
        environments: action.payload.environments || state.environments,
        activeEnvId: action.payload.activeEnvId ?? state.activeEnvId,
        history: action.payload.history || state.history,
        globals: action.payload.globals || state.globals,
        loaded: true,
      };

    // ---- 集合操作 ----
    case APP_ACTIONS.SET_COLLECTIONS:
      return { ...state, collections: action.payload };

    case APP_ACTIONS.ADD_COLLECTION:
      return { ...state, collections: [...state.collections, action.payload] };

    case APP_ACTIONS.UPDATE_NODE:
      return {
        ...state,
        collections: updateNode(state.collections, action.payload.nodeId, action.payload.updater),
      };

    case APP_ACTIONS.REMOVE_NODE:
      return { ...state, collections: removeNode(state.collections, action.payload) };

    case APP_ACTIONS.REMOVE_REQUEST:
      return { ...state, collections: removeRequestById(state.collections, action.payload) };

    case APP_ACTIONS.UPSERT_REQUEST: {
      const { tree } = upsertRequestById(state.collections, action.payload);
      return { ...state, collections: tree };
    }

    case APP_ACTIONS.MOVE_REQUEST:
      return {
        ...state,
        collections: moveRequest(
          state.collections,
          action.payload.reqId,
          action.payload.targetNodeId,
          action.payload.beforeReqId
        ),
      };

    case APP_ACTIONS.MOVE_FOLDER:
      return {
        ...state,
        collections: moveFolder(
          state.collections,
          action.payload.folderId,
          action.payload.targetNodeId,
          action.payload.beforeFolderId
        ),
      };

    // ---- 环境操作 ----
    case APP_ACTIONS.SET_ENVIRONMENTS:
      return { ...state, environments: action.payload };

    case APP_ACTIONS.ADD_ENVIRONMENT:
      return { ...state, environments: [...state.environments, action.payload] };

    case APP_ACTIONS.UPDATE_ENVIRONMENT:
      return {
        ...state,
        environments: state.environments.map((e) =>
          e.id === action.payload.id ? action.payload : e
        ),
      };

    case APP_ACTIONS.DELETE_ENVIRONMENT:
      return {
        ...state,
        environments: state.environments.filter((e) => e.id !== action.payload),
        activeEnvId: state.activeEnvId === action.payload ? null : state.activeEnvId,
      };

    case APP_ACTIONS.SET_ACTIVE_ENV:
      return { ...state, activeEnvId: action.payload };

    case APP_ACTIONS.PERSIST_ENV_CHANGES: {
      const { envSet, envUnset, activeEnvId } = action.payload;
      if (!activeEnvId) return state;
      if (Object.keys(envSet).length === 0 && envUnset.length === 0) return state;
      return {
        ...state,
        environments: state.environments.map((env) => {
          if (env.id !== activeEnvId) return env;
          let vars = env.variables.filter((v) => !envUnset.includes(v.key));
          for (const [k, val] of Object.entries(envSet)) {
            const idx = vars.findIndex((v) => v.key === k);
            if (idx >= 0) {
              vars = vars.map((v, i) => (i === idx ? { ...v, value: val, enabled: true } : v));
            } else {
              vars = [...vars, { key: k, value: val, enabled: true }];
            }
          }
          return { ...env, variables: vars };
        }),
      };
    }

    // ---- 全局变量 ----
    case APP_ACTIONS.SET_GLOBALS:
      return { ...state, globals: action.payload };

    case APP_ACTIONS.UPSERT_GLOBAL_VAR: {
      const { key, value } = action.payload;
      const idx = state.globals.findIndex((v) => v.key === key);
      const globals = idx >= 0
        ? state.globals.map((v, i) => (i === idx ? { ...v, value, enabled: true } : v))
        : [...state.globals, { key, value, enabled: true }];
      return { ...state, globals };
    }

    // ---- 历史 ----
    case APP_ACTIONS.SET_HISTORY:
      return { ...state, history: action.payload };

    case APP_ACTIONS.ADD_HISTORY:
      return { ...state, history: [action.payload, ...state.history].slice(0, 100) };

    case APP_ACTIONS.DELETE_HISTORY_ITEM:
      return { ...state, history: state.history.filter((h) => h.id !== action.payload) };

    case APP_ACTIONS.CLEAR_HISTORY:
      return { ...state, history: [] };

    default:
      return state;
  }
}

// ---- Context ----
const AppStateContext = createContext(null);
const AppDispatchContext = createContext(null);

/** AppState Provider：包裹应用顶层，提供核心业务数据 */
export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(appStateReducer, initialAppState);

  // 派生值：当前激活环境对象 & 变量映射表（高频使用，缓存计算结果）
  const activeEnv = useMemo(
    () => state.environments.find((e) => e.id === state.activeEnvId) || null,
    [state.environments, state.activeEnvId]
  );
  const varMap = useMemo(
    () => buildVarMap(activeEnv, state.globals),
    [activeEnv, state.globals]
  );
  const varNames = useMemo(() => Object.keys(varMap), [varMap]);

  const contextValue = useMemo(
    () => ({ ...state, activeEnv, varMap, varNames }),
    [state, activeEnv, varMap, varNames]
  );

  return (
    <AppStateContext.Provider value={contextValue}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

/** 读取核心业务数据（collections, environments, history, globals, activeEnvId 等） */
export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState 必须在 AppStateProvider 内使用');
  return ctx;
}

/** 获取 dispatch 函数以分发 APP_ACTIONS */
export function useAppDispatch() {
  const dispatch = useContext(AppDispatchContext);
  if (!dispatch) throw new Error('useAppDispatch 必须在 AppStateProvider 内使用');
  return dispatch;
}
