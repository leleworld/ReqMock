/**
 * MockContext — Mock 服务相关状态
 * 管理：mock, mockRunning, mockBusy, mockLogs, selectedRouteId, rtState
 *
 * Mock 服务是独立于请求编辑的子系统，包括路由定义、服务启停、请求日志，
 * 以及 WebSocket/SSE 实时连接的会话状态。
 */
import React, { createContext, useContext, useReducer, useMemo } from 'react';

// ---- 工具函数 ----
function uuid() {
  return crypto.randomUUID();
}

/** 新建 Mock 路由（默认 GET /api/example） */
export function newMockRoute() {
  return {
    id: uuid(),
    name: '新建路由',
    method: 'GET',
    path: '/api/example',
    status: 200,
    headers: [],
    body: '{\n  "message": "hello from mock"\n}',
    delayMs: 0,
    enabled: true,
    rules: [],
    responseMode: 'template',
    script: ''
  };
}

// ---- Action Types ----
export const MOCK_ACTIONS = {
  // Mock 配置
  SET_MOCK: 'SET_MOCK',
  SET_PORT: 'SET_PORT',
  ADD_ROUTE: 'ADD_ROUTE',
  UPDATE_ROUTE: 'UPDATE_ROUTE',
  DELETE_ROUTE: 'DELETE_ROUTE',
  // Mock 服务状态
  SET_MOCK_RUNNING: 'SET_MOCK_RUNNING',
  SET_MOCK_BUSY: 'SET_MOCK_BUSY',
  // Mock 日志
  ADD_MOCK_LOG: 'ADD_MOCK_LOG',
  CLEAR_MOCK_LOGS: 'CLEAR_MOCK_LOGS',
  // 路由选中
  SET_SELECTED_ROUTE: 'SET_SELECTED_ROUTE',
  // WS/SSE 实时状态
  APPLY_RT_EVENT: 'APPLY_RT_EVENT',
  CLEAR_RT_STATE: 'CLEAR_RT_STATE',
  REMOVE_RT_STATE: 'REMOVE_RT_STATE',
};

// ---- Initial State ----
export const initialMockState = {
  mock: { port: 3600, routes: [] },
  mockRunning: false,
  mockBusy: false,
  mockLogs: [],
  selectedRouteId: null,
  rtState: {}, // tabId -> { connected, events: [] }
};

// ---- Reducer ----
export function mockReducer(state, action) {
  switch (action.type) {
    // ---- Mock 配置 ----
    case MOCK_ACTIONS.SET_MOCK:
      return { ...state, mock: action.payload };

    case MOCK_ACTIONS.SET_PORT:
      return { ...state, mock: { ...state.mock, port: action.payload } };

    case MOCK_ACTIONS.ADD_ROUTE:
      return {
        ...state,
        mock: { ...state.mock, routes: [...state.mock.routes, action.payload] },
        selectedRouteId: action.payload.id,
      };

    case MOCK_ACTIONS.UPDATE_ROUTE:
      return {
        ...state,
        mock: {
          ...state.mock,
          routes: state.mock.routes.map((r) => (r.id === action.payload.id ? action.payload : r)),
        },
      };

    case MOCK_ACTIONS.DELETE_ROUTE:
      return {
        ...state,
        mock: {
          ...state.mock,
          routes: state.mock.routes.filter((r) => r.id !== action.payload),
        },
        selectedRouteId: state.selectedRouteId === action.payload ? null : state.selectedRouteId,
      };

    // ---- Mock 服务状态 ----
    case MOCK_ACTIONS.SET_MOCK_RUNNING:
      return { ...state, mockRunning: action.payload };

    case MOCK_ACTIONS.SET_MOCK_BUSY:
      return { ...state, mockBusy: action.payload };

    // ---- Mock 日志 ----
    case MOCK_ACTIONS.ADD_MOCK_LOG:
      return {
        ...state,
        mockLogs: [action.payload, ...state.mockLogs].slice(0, 200),
      };

    case MOCK_ACTIONS.CLEAR_MOCK_LOGS:
      return { ...state, mockLogs: [] };

    // ---- 路由选中 ----
    case MOCK_ACTIONS.SET_SELECTED_ROUTE:
      return { ...state, selectedRouteId: action.payload };

    // ---- WS/SSE 实时状态 ----
    case MOCK_ACTIONS.APPLY_RT_EVENT: {
      const evt = action.payload;
      const cur = state.rtState[evt.id] || { connected: false, events: [] };
      return {
        ...state,
        rtState: {
          ...state.rtState,
          [evt.id]: {
            connected: evt.type === 'open' ? true
              : (evt.type === 'close' || evt.type === 'error') ? false : cur.connected,
            events: [...cur.events, evt].slice(-500),
          },
        },
      };
    }

    case MOCK_ACTIONS.CLEAR_RT_STATE: {
      const id = action.payload;
      const cur = state.rtState[id] || { connected: false };
      return {
        ...state,
        rtState: { ...state.rtState, [id]: { ...cur, events: [] } },
      };
    }

    case MOCK_ACTIONS.REMOVE_RT_STATE: {
      const next = { ...state.rtState };
      delete next[action.payload];
      return { ...state, rtState: next };
    }

    default:
      return state;
  }
}

// ---- Context ----
const MockStateContext = createContext(null);
const MockDispatchContext = createContext(null);

/** MockProvider：包裹应用顶层，管理 Mock 服务和实时连接状态 */
export function MockProvider({ children }) {
  const [state, dispatch] = useReducer(mockReducer, initialMockState);

  const contextValue = useMemo(() => state, [state]);

  return (
    <MockStateContext.Provider value={contextValue}>
      <MockDispatchContext.Provider value={dispatch}>
        {children}
      </MockDispatchContext.Provider>
    </MockStateContext.Provider>
  );
}

/** 读取 Mock 相关状态 */
export function useMockState() {
  const ctx = useContext(MockStateContext);
  if (!ctx) throw new Error('useMockState 必须在 MockProvider 内使用');
  return ctx;
}

/** 获取 Mock dispatch 函数 */
export function useMockDispatch() {
  const dispatch = useContext(MockDispatchContext);
  if (!dispatch) throw new Error('useMockDispatch 必须在 MockProvider 内使用');
  return dispatch;
}
