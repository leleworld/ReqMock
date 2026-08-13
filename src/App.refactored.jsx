/**
 * App.jsx — 重构后的顶层组件
 *
 * 职责精简为：
 * 1. 组装所有 Provider（状态容器）
 * 2. 初始化持久化加载 / 保存
 * 3. 注册全局事件监听（快捷键、拖拽导入、自动更新）
 * 4. 组装布局骨架
 *
 * 所有业务逻辑已拆入各 Context 的 reducer + 独立的 handler hooks。
 * 子组件通过 useXxxState() / useXxxDispatch() 直接消费所需状态。
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, MotionConfig, useAnimate } from 'framer-motion';
import { toastSlide, popoverRise } from './utils/motionPresets.js';

// ---- Context Providers ----
import { AppStateProvider, useAppState, useAppDispatch, APP_ACTIONS } from './contexts/AppStateContext.jsx';
import { TabProvider, useTabState, useTabDispatch, TAB_ACTIONS, createTab, newRequest, isBlankRequest } from './contexts/TabContext.jsx';
import { MockProvider, useMockState, useMockDispatch, MOCK_ACTIONS, newMockRoute } from './contexts/MockContext.jsx';
import { UIProvider, useUIState, useUIDispatch, UI_ACTIONS, useToast, usePushNotice, useChangeSettings } from './contexts/UIContext.jsx';
import { CookieProvider, useCookieState, useCookieDispatch, COOKIE_ACTIONS } from './contexts/CookieContext.jsx';

// ---- Components ----
import Sidebar from './components/Sidebar.jsx';
import TabBar from './components/TabBar.jsx';
import RequestEditor, { RequestBar } from './components/RequestEditor.jsx';
import ResponsePanel from './components/ResponsePanel.jsx';
import MockPanel from './components/MockPanel.jsx';
import CookiePanel from './components/CookiePanel.jsx';
import WsPanel from './components/WsPanel.jsx';
import SsePanel from './components/SsePanel.jsx';
import ToolsPanel, { TOOLS } from './components/ToolsPanel.jsx';
import RunnerPanel from './components/RunnerPanel.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import TopBar from './components/TopBar.jsx';
import { JbIcon } from './components/Icons.jsx';
import UtilBar from './components/UtilBar.jsx';
import ConsolePanel from './components/ConsolePanel.jsx';
import WelcomePage from './components/WelcomePage.jsx';
import EnvironmentPanel from './components/EnvironmentPanel.jsx';
import {
  SaveRequestModal, CollectionSettingsModal, CurlImportModal,
  CodegenModal, ExportCollectionModal, SettingsModal, PromptModal, ConfirmModal, AboutModal
} from './components/Modals.jsx';

// ---- Utils ----
import { normalizeOpenedRequest } from './utils/urlSync.js';
import { executeRequest } from './utils/requestPipeline.js';
import {
  newCollection, newFolder, normalizeNode, normalizeRequest,
  updateNode, removeNode, findNode, findOwnerCollection,
  upsertRequestById, removeRequestById, findRequestPath, findRequestById, moveRequest,
  exportCollection, exportWorkspace, exportEnvironment, exportEnvironments, parseImport
} from './utils/collectionUtil.js';
import { newEnvironment, buildVarMap, resolveRequest, mergeVariables } from './utils/envUtil.js';
import { applyAutoGroups, pickGroupColor, reorderTabsByGroup } from './utils/tabGroupUtil.js';
import { applyAuth } from './utils/authUtil.js';
import { toCurl } from './utils/curlUtil.js';
import { upsertCookies, pruneCookies } from './utils/cookieUtil.js';
import { normalizeSettings, applyTheme } from './utils/themeUtil.js';
import { exportPostmanCollection, exportMarkdownDocs } from './utils/exportUtil.js';
import { buildSampleWorkspace } from './utils/sampleData.js';

function uuid() {
  return crypto.randomUUID();
}

/** 状态栏响应体积展示 */
function formatKb(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/** 状态栏 ⌨ 快捷键速查表 */
const SHORTCUTS = [
  ['发送请求', 'Ctrl+Enter'],
  ['全局搜索 / 命令', 'Ctrl+K'],
  ['保存请求', 'Ctrl+S'],
  ['新建请求标签', 'Ctrl+T'],
  ['关闭标签', 'Ctrl+W'],
  ['复制当前请求标签', 'Ctrl+D'],
  ['循环切换标签', 'Ctrl+Tab / Ctrl+Shift+Tab'],
  ['循环切换环境', 'Ctrl+E'],
  ['快捷键速查', 'Ctrl+/'],
  ['新建窗口', 'Ctrl+Shift+N']
];

// ============================================================
// 最外层 Provider 嵌套
// ============================================================
export default function App() {
  return (
    <AppStateProvider>
      <TabProvider>
        <MockProvider>
          <UIProvider>
            <CookieProvider>
              <MotionConfig reducedMotion="user">
                <AppShell />
              </MotionConfig>
            </CookieProvider>
          </UIProvider>
        </MockProvider>
      </TabProvider>
    </AppStateProvider>
  );
}

// ============================================================
// AppShell：真正的布局组件，消费所有 Context
// ============================================================
function AppShell() {
  // ---- 消费各 Context ----
  const appState = useAppState();
  const appDispatch = useAppDispatch();
  const { collections, environments, activeEnvId, history, globals, loaded, activeEnv, varMap, varNames } = appState;

  const tabState = useTabState();
  const tabDispatch = useTabDispatch();
  const { tabs, activeTabId, tabGroups, curTab, dismissedGroupKeysRef } = tabState;

  const mockState = useMockState();
  const mockDispatch = useMockDispatch();
  const { mock, mockRunning, mockBusy, mockLogs, selectedRouteId, rtState } = mockState;

  const uiState = useUIState();
  const uiDispatch = useUIDispatch();
  const { toast, notices, noticeUnread, noticesOpen, modal, prompt, confirm,
          paletteOpen, consoleOpen, consoleLogs, scriptLogs, kbdOpen, settings,
          appVersion, updateProgress } = uiState;

  const { cookieJar } = useCookieState();
  const cookieDispatch = useCookieDispatch();

  // ---- 便捷 hooks ----
  const showToast = useToast();
  const pushNotice = usePushNotice();
  const handleChangeSettings = useChangeSettings();

  // ---- 派生状态 ----
  const activeRequest = curTab.kind === 'request' ? curTab.request : null;

  // ---- 活动栏 ----
  const [activity, setActivity] = useState('collections');
  const [panelOpen, setPanelOpen] = useState(true);
  const handleActivity = (key) => {
    if (key === activity) setPanelOpen((v) => !v);
    else { setActivity(key); setPanelOpen(true); }
  };

  // ---- 分栏拖拽 ----
  const workspaceRef = useRef(null);
  const [splitDrag, setSplitDrag] = useState(false);
  const [focusResponse, setFocusResponse] = useState(false);
  useEffect(() => { setFocusResponse(false); }, [curTab.id]);
  useEffect(() => {
    if (!focusResponse) return;
    const onKey = (e) => { if (e.key === 'Escape') setFocusResponse(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusResponse]);

  const handleSplitDown = (e) => {
    e.preventDefault();
    const el = workspaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const horizontal = settings.layout === 'horizontal';
    setSplitDrag(true);
    document.body.classList.add('resizing');
    const onMove = (ev) => {
      const ratio = horizontal
        ? ((ev.clientX - rect.left) / rect.width) * 100
        : ((ev.clientY - rect.top) / rect.height) * 100;
      const v = Math.round(Math.min(75, Math.max(25, ratio)) * 10) / 10;
      handleChangeSettings(horizontal ? { splitH: v } : { splitV: v });
    };
    const onUp = () => {
      setSplitDrag(false);
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ---- Tab helpers ----
  const patchTab = useCallback((tabId, patch) => {
    tabDispatch({ type: TAB_ACTIONS.PATCH_TAB, payload: { tabId, patch } });
  }, [tabDispatch]);

  const setActiveRequest = (req) => patchTab(curTab.id, { request: req });

  const isTabDirty = useCallback((tab) => {
    if (!tab || tab.kind !== 'request') return false;
    const saved = findRequestById(collections, tab.request.id);
    if (saved) return JSON.stringify(normalizeRequest(saved)) !== JSON.stringify(normalizeRequest(tab.request));
    return !isBlankRequest(tab.request);
  }, [collections]);

  /** 打开单例页面标签（环境/Cookie/Mock/工具）：已打开则直接聚焦 */
  const openPageTab = (kind, extra = {}) => {
    const found = tabs.find((t) => t.kind === kind &&
      (kind !== 'env' || t.envId === extra.envId) &&
      (kind !== 'tool' || t.tool === extra.tool) &&
      (kind !== 'runner' || t.nodeId === extra.nodeId));
    if (found) {
      tabDispatch({ type: TAB_ACTIONS.SET_ACTIVE_TAB, payload: found.id });
      return;
    }
    const tab = { id: uuid(), kind, ...extra };
    tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab } });
  };

  /** 非请求标签的图标与名称（TabBar 用） */
  const tabMeta = (tab) => {
    if (tab.kind === 'welcome') return { icon: 'galaxy', label: '欢迎', title: '欢迎使用 ReqMock' };
    if (tab.kind === 'env') {
      if (tab.envId === '__globals__') return { icon: 'galaxy', label: '全局变量', title: '全局变量' };
      const env = environments.find((e) => e.id === tab.envId);
      return { icon: 'earth', label: env ? env.name : '环境已删除', title: '环境变量' };
    }
    if (tab.kind === 'cookies') return { icon: 'archive', label: 'Cookie 管理', title: 'Cookie 管理器' };
    if (tab.kind === 'mock') return { icon: 'services', label: 'Mock 服务', title: 'Mock 服务面板' };
    if (tab.kind === 'tool') {
      const t = TOOLS.find((x) => x.key === tab.tool);
      return { icon: t ? t.icon : 'puzzle', label: t ? t.label : '工具', title: '工具箱' };
    }
    if (tab.kind === 'runner') {
      const node = findNode(collections, tab.nodeId);
      return { icon: 'play', label: node ? `运行 ${node.name}` : '批量运行', title: 'Collection Runner' };
    }
    if (tab.kind === 'ws') return { icon: 'link', label: (tab.config && tab.config.name) || 'WebSocket', title: 'WebSocket 连接' };
    if (tab.kind === 'sse') return { icon: 'activity', label: (tab.config && tab.config.name) || 'SSE', title: 'SSE 连接' };
    return { icon: 'file', label: '未知页面', title: '' };
  };

  // =========================================================
  // 初始化：加载持久化数据、注册 IPC 事件
  // =========================================================
  const manualUpdateCheckRef = useRef(false);
  useEffect(() => {
    window.api.loadStore().then((saved) => {
      if (saved) {
        appDispatch({
          type: APP_ACTIONS.HYDRATE,
          payload: {
            collections: saved.collections ? saved.collections.map(normalizeNode) : undefined,
            environments: saved.environments,
            activeEnvId: saved.activeEnvId,
            history: saved.history,
            globals: Array.isArray(saved.globals) ? saved.globals : undefined,
          },
        });
        if (Array.isArray(saved.cookieJar)) {
          cookieDispatch({ type: COOKIE_ACTIONS.SET_JAR, payload: pruneCookies(saved.cookieJar) });
        }
        if (saved.mock) {
          mockDispatch({ type: MOCK_ACTIONS.SET_MOCK, payload: saved.mock });
        }
        const st = normalizeSettings(saved.settings);
        uiDispatch({ type: UI_ACTIONS.SET_SETTINGS, payload: st });

        if (Array.isArray(saved.openTabs) && saved.openTabs.length > 0) {
          const restored = saved.openTabs.map((t) => {
            if (t.kind && t.kind !== 'request') {
              return { id: t.id || uuid(), kind: t.kind, envId: t.envId, tool: t.tool, nodeId: t.nodeId, config: t.config, groupId: t.groupId };
            }
            return {
              ...createTab(normalizeOpenedRequest(normalizeRequest(t.request || {}))),
              id: t.id || uuid(),
              groupId: t.groupId
            };
          });
          tabDispatch({
            type: TAB_ACTIONS.HYDRATE_TABS,
            payload: {
              tabs: restored,
              activeTabId: restored.some((t) => t.id === saved.activeTabId) ? saved.activeTabId : restored[0].id,
              tabGroups: Array.isArray(saved.tabGroups) ? saved.tabGroups : [],
            },
          });
        }
      } else {
        // 首次启动：注入示例集合/环境并打开欢迎页
        const sample = buildSampleWorkspace();
        appDispatch({
          type: APP_ACTIONS.HYDRATE,
          payload: {
            collections: sample.collections,
            environments: sample.environments,
            activeEnvId: sample.activeEnvId,
          },
        });
        const welcomeTab = { id: uuid(), kind: 'welcome' };
        tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab: welcomeTab } });
      }
    });
    if (window.api.appVersion) {
      window.api.appVersion().then((v) => uiDispatch({ type: UI_ACTIONS.SET_APP_VERSION, payload: v }));
    }
    window.api.mockStatus().then((s) => mockDispatch({ type: MOCK_ACTIONS.SET_MOCK_RUNNING, payload: s.running }));

    // Mock 日志
    const unsubMock = window.api.onMockLog((entry) => {
      mockDispatch({ type: MOCK_ACTIONS.ADD_MOCK_LOG, payload: entry });
    });
    // WS/SSE 事件
    const applyRtEvent = (evt) => mockDispatch({ type: MOCK_ACTIONS.APPLY_RT_EVENT, payload: evt });
    const unsubWs = window.api.onWsEvent(applyRtEvent);
    const unsubSse = window.api.onSseEvent(applyRtEvent);
    return () => { unsubMock(); unsubWs(); unsubSse(); };
  }, []);

  // ---- 状态变化去抖持久化 ----
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.api.saveStore({
        collections, environments, activeEnvId, history, mock,
        cookieJar, globals, settings,
        openTabs: tabs.map((t) => (
          t.kind === 'request'
            ? { id: t.id, kind: 'request', request: t.request, groupId: t.groupId }
            : { id: t.id, kind: t.kind, envId: t.envId, tool: t.tool, nodeId: t.nodeId, config: t.config, groupId: t.groupId }
        )),
        tabGroups,
        activeTabId: curTab.id
      });
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [loaded, collections, environments, activeEnvId, history, mock, cookieJar, globals, settings, tabs, tabGroups, activeTabId]);

  // ---- 自动分组 ----
  useEffect(() => {
    if (!loaded) return;
    const r = applyAutoGroups(tabs, tabGroups, uuid, dismissedGroupKeysRef.current);
    if (r.changed) {
      tabDispatch({ type: TAB_ACTIONS.APPLY_AUTO_GROUPS, payload: { tabs: r.tabs, groups: r.groups } });
    }
  }, [loaded, tabs, tabGroups]);

  // ---- Mock 运行中路由热更新 ----
  useEffect(() => {
    if (mockRunning) window.api.updateMockRoutes(mock.routes);
  }, [mockRunning, mock.routes]);

  // ---- 自动更新事件 ----
  useEffect(() => {
    const unsub = window.api.onUpdateEvent((evt) => {
      if (evt.type === 'available') {
        manualUpdateCheckRef.current = false;
        pushNotice(`发现新版本 v${evt.version}`, 'info');
        uiDispatch({
          type: UI_ACTIONS.SET_CONFIRM,
          payload: {
            title: '发现新版本',
            message: `新版本 v${evt.version} 可用，是否立即下载？下载完成后会提示重启安装。`,
            onConfirm: () => { uiDispatch({ type: UI_ACTIONS.SET_UPDATE_PROGRESS, payload: 0 }); window.api.downloadUpdate(); }
          }
        });
      } else if (evt.type === 'not-available') {
        if (manualUpdateCheckRef.current) showToast('当前已是最新版本', 'success');
        manualUpdateCheckRef.current = false;
      } else if (evt.type === 'progress') {
        uiDispatch({ type: UI_ACTIONS.SET_UPDATE_PROGRESS, payload: Math.min(100, Math.round(evt.percent || 0)) });
      } else if (evt.type === 'downloaded') {
        uiDispatch({ type: UI_ACTIONS.SET_UPDATE_PROGRESS, payload: null });
        uiDispatch({
          type: UI_ACTIONS.SET_CONFIRM,
          payload: {
            title: '更新已就绪',
            message: `v${evt.version} 下载完成，立即重启安装？取消则在退出应用时自动安装。`,
            onConfirm: () => window.api.installUpdate()
          }
        });
      } else if (evt.type === 'error') {
        uiDispatch({ type: UI_ACTIONS.SET_UPDATE_PROGRESS, payload: null });
        if (manualUpdateCheckRef.current) showToast('检查更新失败：' + evt.message, 'error');
        else pushNotice('自动更新失败：' + evt.message, 'error');
        manualUpdateCheckRef.current = false;
      }
    });
    return unsub;
  }, [showToast, pushNotice]);

  const handleCheckUpdate = async () => {
    manualUpdateCheckRef.current = true;
    const res = await window.api.checkUpdate();
    if (res && !res.ok) {
      manualUpdateCheckRef.current = false;
      if (res.reason === 'dev') showToast('开发模式下不支持检查更新（需安装包环境）', 'warn');
      else showToast('检查更新失败：' + (res.error || '未知错误'), 'error');
    }
  };

  // ---- 通知中心 & 键盘速查弹层关闭逻辑 ----
  useEffect(() => {
    if (!noticesOpen) return;
    const onMouseDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.notice-popover') || e.target.closest('[data-notice-toggle]')) return;
      uiDispatch({ type: UI_ACTIONS.SET_NOTICES_OPEN, payload: false });
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') uiDispatch({ type: UI_ACTIONS.SET_NOTICES_OPEN, payload: false }); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [noticesOpen]);

  useEffect(() => {
    if (!kbdOpen) return;
    const onMouseDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.kbd-popover') || e.target.closest('[data-kbd-toggle]')) return;
      uiDispatch({ type: UI_ACTIONS.SET_KBD_OPEN, payload: false });
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') uiDispatch({ type: UI_ACTIONS.SET_KBD_OPEN, payload: false }); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [kbdOpen]);

  // ---- 切换标签动画 ----
  const [pageScope, animatePage] = useAnimate();
  useEffect(() => {
    if (!pageScope.current) return;
    animatePage(pageScope.current, { opacity: [0, 1], y: [5, 0] }, { duration: 0.16, ease: 'easeOut' });
  }, [curTab.id]);

  // =========================================================
  // 业务 Handler（简化版，通过 dispatch 委托给 reducer）
  // =========================================================
  const handleToggleNotices = () => uiDispatch({ type: UI_ACTIONS.TOGGLE_NOTICES });

  // ---- 请求发送 ----
  const sendTokensRef = useRef(new Map());
  const doSend = async (tabId, reqSnapshot) => {
    patchTab(tabId, { sending: true, response: null, scriptResult: null });
    const cancelToken = uuid();
    sendTokensRef.current.set(tabId, cancelToken);
    const { result, finalReq, logs, tests, errors, envSet, envUnset, cookieOn } =
      await executeRequest(reqSnapshot, {
        collections,
        varMap,
        settings,
        cookieJar,
        send: (payload) => window.api.sendRequest(payload),
        cancelToken
      });
    sendTokensRef.current.delete(tabId);
    // 脚本产生的环境变量变更写回
    appDispatch({ type: APP_ACTIONS.PERSIST_ENV_CHANGES, payload: { envSet, envUnset, activeEnvId } });
    // Cookie 写入
    if (cookieOn && result.setCookies && result.setCookies.length > 0) {
      cookieDispatch({ type: COOKIE_ACTIONS.UPSERT_COOKIES, payload: { cookies: result.setCookies, url: result.finalUrl || finalReq.url } });
    }
    const scriptResult = tests.length || logs.length || errors.length ? { tests, logs, errors } : null;
    const finalResult = result.ok ? result : { ...result, finalRequest: finalReq };
    // 写回标签
    tabDispatch({
      type: TAB_ACTIONS.PATCH_TAB,
      payload: {
        tabId,
        patch: {
          sending: false,
          response: finalResult,
          scriptResult,
          responseHistory: [
            { id: uuid(), time: new Date().toLocaleTimeString(), response: finalResult, scriptResult },
            ...(tabs.find((t) => t.id === tabId)?.responseHistory || [])
          ].slice(0, 20)
        }
      }
    });
    // 控制台日志
    uiDispatch({
      type: UI_ACTIONS.ADD_CONSOLE_LOG,
      payload: {
        id: uuid(), time: new Date().toLocaleTimeString(),
        method: finalReq.method, url: finalReq.url, ok: result.ok, status: result.status,
        timeMs: result.timeMs, error: result.error,
        requestHeaders: (finalReq.headers || []).filter((h) => h.enabled !== false && h.key),
        responseHeaders: result.headers || {}
      }
    });
    if (logs.length) {
      const source = reqSnapshot.name || finalReq.url;
      const time = new Date().toLocaleTimeString();
      uiDispatch({
        type: UI_ACTIONS.ADD_SCRIPT_LOGS,
        payload: logs.map((l) => ({ id: uuid(), time, source, level: l.level, text: l.text }))
      });
    }
    if (!result.ok) pushNotice(`请求失败 ${finalReq.url}：${result.error || '未知错误'}`, 'error');
    if (errors.length) pushNotice(`脚本异常（${reqSnapshot.name || finalReq.url}）：${errors.join('；')}`, 'error');
    // 历史
    const snapBody = typeof result.body === 'string' ? result.body.slice(0, 20480) : '';
    appDispatch({
      type: APP_ACTIONS.ADD_HISTORY,
      payload: {
        ...reqSnapshot, id: uuid(), requestId: reqSnapshot.id,
        time: new Date().toISOString(), status: result.ok ? result.status : 'ERR',
        timeMs: result.timeMs, sizeBytes: result.ok ? result.sizeBytes : undefined,
        responseSnapshot: result.ok ? {
          status: result.status, statusText: result.statusText, headers: result.headers,
          body: snapBody, bodyTruncated: typeof result.body === 'string' && result.body.length > 20480,
          timeMs: result.timeMs, sizeBytes: result.sizeBytes
        } : undefined
      }
    });
  };

  const handleSend = async () => {
    if (curTab.kind !== 'request') return;
    if (!curTab.request.url) { showToast('请先填写 URL', 'warn'); return; }
    await doSend(curTab.id, curTab.request);
  };
  const handleRetryNoSsl = () => {
    if (curTab.kind !== 'request') return;
    const req = { ...curTab.request, sslVerify: false };
    patchTab(curTab.id, { request: req });
    doSend(curTab.id, req);
  };
  const handleCancelSend = () => {
    const token = sendTokensRef.current.get(curTab.id);
    if (token) window.api.cancelRequest(token);
  };
  const handleSelectHistory = (h) => patchTab(curTab.id, { response: h.response, scriptResult: h.scriptResult });

  // ---- 请求保存 ----
  const handleRenameRequest = () => {
    if (!activeRequest) return;
    uiDispatch({
      type: UI_ACTIONS.SET_PROMPT,
      payload: {
        title: '重命名请求', label: '请求名称', defaultValue: activeRequest.name || '未命名请求',
        onConfirm: (name) => {
          if (!name || name === activeRequest.name) return;
          const req = { ...activeRequest, name };
          setActiveRequest(req);
          appDispatch({ type: APP_ACTIONS.UPSERT_REQUEST, payload: req });
        }
      }
    });
  };

  const handleSaveRequest = () => {
    if (!activeRequest) return;
    const { tree, found } = upsertRequestById(collections, activeRequest);
    if (found) {
      appDispatch({ type: APP_ACTIONS.SET_COLLECTIONS, payload: tree });
      showToast('已保存', 'success');
    } else {
      uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'save' } });
    }
  };

  const handleSaveConfirm = (name, targetId) => {
    const req = { ...activeRequest, name };
    setActiveRequest(req);
    appDispatch({
      type: APP_ACTIONS.UPDATE_NODE,
      payload: { nodeId: targetId, updater: (node) => ({ ...node, requests: [...(node.requests || []), req] }) }
    });
    uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null });
    showToast('已保存到集合', 'success');
  };

  // ---- 打开请求 ----
  const handleOpenRequest = (req) => {
    const request = normalizeOpenedRequest(normalizeRequest(req));
    const existing = tabs.find((t) => t.kind === 'request' && t.request.id === request.id);
    if (existing) { tabDispatch({ type: TAB_ACTIONS.SET_ACTIVE_TAB, payload: existing.id }); return; }
    if (curTab.kind === 'request' && isBlankRequest(curTab.request)) {
      patchTab(curTab.id, { request, response: null, scriptResult: null });
      return;
    }
    tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab: createTab(request) } });
  };

  const handleOpenHistoryItem = (item, withSnapshot = false) => {
    const { responseSnapshot, requestId, time, status, timeMs, sizeBytes, ...rest } = item;
    const request = normalizeOpenedRequest(normalizeRequest({ ...rest, id: requestId || item.id }));
    const snap = withSnapshot && responseSnapshot ? { ok: true, ...responseSnapshot, fromHistory: true, historyTime: time } : null;
    const existing = tabs.find((t) => t.kind === 'request' && t.request.id === request.id);
    if (existing) {
      tabDispatch({ type: TAB_ACTIONS.SET_ACTIVE_TAB, payload: existing.id });
      if (snap) patchTab(existing.id, { response: snap, scriptResult: null });
      return;
    }
    if (curTab.kind === 'request' && isBlankRequest(curTab.request)) {
      patchTab(curTab.id, { request, response: snap, scriptResult: null });
      return;
    }
    tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab: { ...createTab(request), response: snap } } });
  };

  const handleDeleteHistoryItem = (id) => appDispatch({ type: APP_ACTIONS.DELETE_HISTORY_ITEM, payload: id });
  const handleClearHistory = () => {
    uiDispatch({
      type: UI_ACTIONS.SET_CONFIRM,
      payload: { title: '清空历史', message: '确定清空全部请求历史？此操作不可撤销。', danger: true, onConfirm: () => appDispatch({ type: APP_ACTIONS.CLEAR_HISTORY }) }
    });
  };
  const handleCopyHistoryCurl = async (item) => {
    try { await navigator.clipboard.writeText(toCurl(normalizeRequest(item))); showToast('cURL 命令已复制到剪贴板', 'success'); }
    catch (e) { showToast('复制失败：' + e.message, 'error'); }
  };

  // ---- 标签操作 ----
  const handleNewTab = () => tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab: createTab(newRequest()) } });
  const handleNewRealtimeTab = (kind) => {
    const tab = { id: uuid(), kind, config: { name: kind === 'ws' ? 'WebSocket' : 'SSE', url: '', headers: [] } };
    tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab } });
  };

  const closeRealtime = (tab) => {
    if (!tab || (tab.kind !== 'ws' && tab.kind !== 'sse')) return;
    if (tab.kind === 'ws') window.api.wsClose(tab.id);
    else window.api.sseClose(tab.id);
    mockDispatch({ type: MOCK_ACTIONS.REMOVE_RT_STATE, payload: tab.id });
  };

  const handleCloseTab = (tabId, force = false) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!force && tab && (tab.pinned || (tab.groupId && tabGroups.some((g) => g.id === tab.groupId && g.pinned)))) {
      showToast('该标签已固定，右键取消固定后才能关闭', 'warn'); return;
    }
    if (!force && isTabDirty(tab)) {
      uiDispatch({
        type: UI_ACTIONS.SET_CONFIRM,
        payload: {
          title: '关闭未保存的标签',
          message: `「${tab.request.name || '未命名请求'}」有未保存的修改，关闭后将丢失，确定关闭？`,
          danger: true, onConfirm: () => handleCloseTab(tabId, true)
        }
      });
      return;
    }
    closeRealtime(tab);
    tabDispatch({ type: TAB_ACTIONS.CLOSE_TAB, payload: tabId });
  };

  // ---- 标签分组 ----
  const handleNewGroup = (tabId) => {
    uiDispatch({
      type: UI_ACTIONS.SET_PROMPT,
      payload: {
        title: '新建分组', label: '分组名称', defaultValue: '新分组',
        onConfirm: (name) => {
          const group = { id: uuid(), name, color: pickGroupColor(tabGroups), collapsed: false, auto: false };
          tabDispatch({ type: TAB_ACTIONS.ADD_GROUP, payload: { group, tabId } });
        }
      }
    });
  };
  const handleAssignGroup = (tabId, groupId) => tabDispatch({ type: TAB_ACTIONS.ASSIGN_GROUP, payload: { tabId, groupId } });
  const handleLeaveGroup = (tabId) => tabDispatch({ type: TAB_ACTIONS.LEAVE_GROUP, payload: tabId });
  const handleRenameGroup = (groupId) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (!group) return;
    uiDispatch({
      type: UI_ACTIONS.SET_PROMPT,
      payload: {
        title: '重命名分组', label: '分组名称', defaultValue: group.name,
        onConfirm: (name) => { if (name !== group.name) tabDispatch({ type: TAB_ACTIONS.UPDATE_GROUP, payload: { groupId, patch: { name } } }); }
      }
    });
  };
  const handleRecolorGroup = (groupId, color) => tabDispatch({ type: TAB_ACTIONS.UPDATE_GROUP, payload: { groupId, patch: { color } } });
  const handleToggleGroupCollapse = (groupId) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (group) tabDispatch({ type: TAB_ACTIONS.UPDATE_GROUP, payload: { groupId, patch: { collapsed: !group.collapsed } } });
  };
  const handleTogglePinTab = (tabId) => tabDispatch({ type: TAB_ACTIONS.TOGGLE_PIN_TAB, payload: tabId });
  const handleTogglePinGroup = (groupId) => tabDispatch({ type: TAB_ACTIONS.TOGGLE_PIN_GROUP, payload: groupId });
  const handleUngroup = (groupId) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (group && group.urlKey) dismissedGroupKeysRef.current.add(group.urlKey);
    tabDispatch({ type: TAB_ACTIONS.UNGROUP, payload: groupId });
  };
  const handleCloseGroup = (groupId, force = false) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (group && group.pinned) { showToast('该分组已固定，取消固定后才能关闭', 'warn'); return; }
    const dirtyCount = tabs.filter((t) => t.groupId === groupId && isTabDirty(t)).length;
    if (!force && dirtyCount > 0) {
      uiDispatch({
        type: UI_ACTIONS.SET_CONFIRM,
        payload: {
          title: '关闭分组',
          message: `分组内有 ${dirtyCount} 个标签存在未保存的修改，关闭后将丢失，确定全部关闭？`,
          danger: true, onConfirm: () => handleCloseGroup(groupId, true)
        }
      });
      return;
    }
    if (group && group.urlKey) dismissedGroupKeysRef.current.add(group.urlKey);
    tabs.filter((t) => t.groupId === groupId).forEach(closeRealtime);
    tabDispatch({ type: TAB_ACTIONS.CLOSE_GROUP, payload: groupId });
  };

  const handleDuplicateTab = () => {
    if (curTab.kind !== 'request') return;
    const req = normalizeRequest({ ...curTab.request, id: uuid(), name: (curTab.request.name || '未命名请求') + ' 副本' });
    tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab: createTab(req) } });
    showToast('已复制为新标签', 'success');
  };

  const handleCycleTab = (dir) => {
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === curTab.id);
    tabDispatch({ type: TAB_ACTIONS.SET_ACTIVE_TAB, payload: tabs[(idx + dir + tabs.length) % tabs.length].id });
  };

  const handleCycleEnv = () => {
    if (environments.length === 0) { showToast('暂无环境，请先在环境面板创建', 'warn'); return; }
    const ids = [null, ...environments.map((e) => e.id)];
    const next = ids[(ids.indexOf(activeEnvId) + 1) % ids.length];
    appDispatch({ type: APP_ACTIONS.SET_ACTIVE_ENV, payload: next });
    const env = environments.find((e) => e.id === next);
    showToast(env ? `已切换环境：${env.name}` : '已切换为无环境');
  };

  // ---- 快捷键 ----
  const hotkeysRef = useRef({});
  hotkeysRef.current = { send: handleSend, save: handleSaveRequest, newTab: handleNewTab, closeTab: () => handleCloseTab(curTab.id), dupTab: handleDuplicateTab, cycleTab: handleCycleTab, cycleEnv: handleCycleEnv };
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const h = hotkeysRef.current;
      if (k === 'enter') { e.preventDefault(); h.send(); }
      else if (k === 'k' || (k === 'p' && e.shiftKey)) { e.preventDefault(); uiDispatch({ type: UI_ACTIONS.SET_PALETTE_OPEN, payload: !paletteOpen }); }
      else if (k === 's') { e.preventDefault(); h.save(); }
      else if (k === 't') { e.preventDefault(); h.newTab(); }
      else if (k === 'w') { e.preventDefault(); h.closeTab(); }
      else if (k === 'd') { e.preventDefault(); h.dupTab(); }
      else if (k === 'tab') { e.preventDefault(); h.cycleTab(e.shiftKey ? -1 : 1); }
      else if (k === 'e') { e.preventDefault(); h.cycleEnv(); }
      else if (k === 'b') { e.preventDefault(); setPanelOpen((v) => !v); }
      else if (k === '/') { e.preventDefault(); uiDispatch({ type: UI_ACTIONS.SET_KBD_OPEN, payload: !kbdOpen }); }
      else if (k === 'n' && e.shiftKey) { e.preventDefault(); window.api.newWindow(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- 环境 ----
  const handleNewEnv = () => {
    const env = newEnvironment(`环境 ${environments.length + 1}`);
    appDispatch({ type: APP_ACTIONS.ADD_ENVIRONMENT, payload: env });
    openPageTab('env', { envId: env.id });
  };
  const handleUpdateEnv = (env) => appDispatch({ type: APP_ACTIONS.UPDATE_ENVIRONMENT, payload: env });
  const handleDeleteEnv = (envId) => {
    uiDispatch({
      type: UI_ACTIONS.SET_CONFIRM,
      payload: {
        title: '删除环境', message: '确定删除该环境？其中的变量将一并删除。', danger: true,
        onConfirm: () => {
          appDispatch({ type: APP_ACTIONS.DELETE_ENVIRONMENT, payload: envId });
          const envTab = tabs.find((t) => t.kind === 'env' && t.envId === envId);
          if (envTab) handleCloseTab(envTab.id, true);
        }
      }
    });
  };

  // ---- 集合树操作 ----
  const handleNewCollection = () => {
    uiDispatch({ type: UI_ACTIONS.SET_PROMPT, payload: { title: '新建集合', label: '集合名称', defaultValue: `集合 ${collections.length + 1}`, onConfirm: (name) => appDispatch({ type: APP_ACTIONS.ADD_COLLECTION, payload: newCollection(name) }) } });
  };
  const handleAddFolder = (parentId) => {
    uiDispatch({ type: UI_ACTIONS.SET_PROMPT, payload: { title: '新建文件夹', label: '文件夹名称', defaultValue: '新建文件夹', onConfirm: (name) => appDispatch({ type: APP_ACTIONS.UPDATE_NODE, payload: { nodeId: parentId, updater: (node) => ({ ...node, folders: [...(node.folders || []), newFolder(name)] }) } }) } });
  };
  const handleRenameNode = (nodeId, currentName) => {
    uiDispatch({ type: UI_ACTIONS.SET_PROMPT, payload: { title: '重命名', label: '名称', defaultValue: currentName, onConfirm: (name) => { if (name !== currentName) appDispatch({ type: APP_ACTIONS.UPDATE_NODE, payload: { nodeId, updater: (node) => ({ ...node, name }) } }); } } });
  };
  const handleDeleteFolder = (folderId) => {
    uiDispatch({ type: UI_ACTIONS.SET_CONFIRM, payload: { title: '删除文件夹', message: '确定删除该文件夹及其中所有请求？', danger: true, onConfirm: () => appDispatch({ type: APP_ACTIONS.REMOVE_NODE, payload: folderId }) } });
  };
  const handleDeleteCollection = (colId) => {
    uiDispatch({ type: UI_ACTIONS.SET_CONFIRM, payload: { title: '删除集合', message: '确定删除该集合及其中所有请求？', danger: true, onConfirm: () => appDispatch({ type: APP_ACTIONS.SET_COLLECTIONS, payload: collections.filter((c) => c.id !== colId) }) } });
  };
  const handleDeleteRequest = (reqId) => {
    uiDispatch({ type: UI_ACTIONS.SET_CONFIRM, payload: { title: '删除请求', message: '确定删除该请求？此操作不可撤销。', danger: true, onConfirm: () => appDispatch({ type: APP_ACTIONS.REMOVE_REQUEST, payload: reqId }) } });
  };
  const handleCollectionSettings = (colId) => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'colSettings', colId } });
  const handleMoveRequest = (reqId, targetNodeId, beforeReqId = null) => {
    appDispatch({ type: APP_ACTIONS.MOVE_REQUEST, payload: { reqId, targetNodeId, beforeReqId } });
  };
  const handleOpenRunner = (nodeId) => openPageTab('runner', { nodeId });
  const handleSettingsConfirm = (colId, patch) => {
    appDispatch({ type: APP_ACTIONS.UPDATE_NODE, payload: { nodeId: colId, updater: (node) => ({ ...node, ...patch }) } });
    uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null });
    showToast('集合设置已保存', 'success');
  };

  // ---- Mock 操作 ----
  const handleMockToggle = async () => {
    if (mockBusy) return;
    mockDispatch({ type: MOCK_ACTIONS.SET_MOCK_BUSY, payload: true });
    try {
      if (mockRunning) {
        await window.api.stopMock();
        mockDispatch({ type: MOCK_ACTIONS.SET_MOCK_RUNNING, payload: false });
        showToast('Mock 服务已停止');
      } else {
        const result = await window.api.startMock({ port: mock.port, routes: mock.routes });
        if (result.ok) {
          mockDispatch({ type: MOCK_ACTIONS.SET_MOCK_RUNNING, payload: true });
          showToast(`Mock 服务已启动: http://localhost:${mock.port}`, 'success');
        } else showToast('启动失败: ' + result.error, 'error');
      }
    } finally {
      mockDispatch({ type: MOCK_ACTIONS.SET_MOCK_BUSY, payload: false });
    }
  };
  const handleAddRoute = () => mockDispatch({ type: MOCK_ACTIONS.ADD_ROUTE, payload: newMockRoute() });
  const handleUpdateRoute = (route) => mockDispatch({ type: MOCK_ACTIONS.UPDATE_ROUTE, payload: route });
  const handleDeleteRoute = (routeId) => {
    uiDispatch({ type: UI_ACTIONS.SET_CONFIRM, payload: { title: '删除 Mock 路由', message: '确定删除该 Mock 路由？其中的条件规则将一并删除。', danger: true, onConfirm: () => mockDispatch({ type: MOCK_ACTIONS.DELETE_ROUTE, payload: routeId }) } });
  };
  const handleResponseToMock = () => {
    const response = curTab.response;
    if (!response || !response.ok) { showToast('没有可转换的成功响应', 'warn'); return; }
    let pathName = '/';
    try { pathName = new URL(response.finalUrl || activeRequest.url).pathname; } catch (e) { /* 保持默认 */ }
    const contentType = response.headers['content-type'] || 'application/json; charset=utf-8';
    const route = { ...newMockRoute(), name: `${activeRequest.method} ${pathName}`, method: activeRequest.method, path: pathName, status: response.status, headers: [{ key: 'Content-Type', value: contentType, enabled: true }], body: response.body };
    mockDispatch({ type: MOCK_ACTIONS.ADD_ROUTE, payload: route });
    openPageTab('mock');
    showToast('已生成 Mock 路由', 'success');
  };
  const handleRouteToRequest = (route) => {
    const req = { ...newRequest(), name: route.name, method: route.method === 'ANY' ? 'GET' : route.method, url: `http://localhost:${mock.port}${route.path.replace(/:([\w-]+)/g, '1').replace(/\*/g, 'x')}` };
    tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab: createTab(req) } });
  };

  // ---- 导入/导出（简化，保留核心逻辑） ----
  const ioBusyRef = useRef(false);
  const applyImportContent = (content) => {
    try {
      const { collections: cols, environments: envs, globals: gvars = [] } = parseImport(content);
      if (cols.length) appDispatch({ type: APP_ACTIONS.SET_COLLECTIONS, payload: [...collections, ...cols] });
      if (envs.length) appDispatch({ type: APP_ACTIONS.SET_ENVIRONMENTS, payload: [...environments, ...envs] });
      if (gvars.length) appDispatch({ type: APP_ACTIONS.SET_GLOBALS, payload: mergeVariables(globals, gvars) });
      const parts = [];
      if (cols.length) parts.push(`${cols.length} 个集合`);
      if (envs.length) parts.push(`${envs.length} 个环境`);
      if (gvars.length) parts.push(`${gvars.length} 个全局变量`);
      if (parts.length) showToast(`导入成功：${parts.join('，')}`, 'success');
      else showToast('导入完成：文件中没有可导入的数据', 'warn');
    } catch (e) { showToast('导入失败：' + e.message, 'error'); }
  };
  const handleImport = async () => {
    if (ioBusyRef.current) return;
    ioBusyRef.current = true;
    try {
      const res = await window.api.importFile();
      if (!res.ok) { if (!res.canceled) showToast('导入失败：' + res.error, 'error'); return; }
      applyImportContent(res.content);
    } finally { ioBusyRef.current = false; }
  };
  const handleExportCollection = (colId) => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'exportCol', colId } });
  const handleExportColConfirm = async (format) => {
    const col = collections.find((c) => c.id === modal.colId);
    uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null });
    if (!col) return;
    let defaultName, content;
    if (format === 'postman') { defaultName = `${col.name}.postman.json`; content = exportPostmanCollection(col); }
    else if (format === 'markdown') { defaultName = `${col.name}.md`; content = exportMarkdownDocs(col); }
    else { defaultName = `${col.name}.reqmock.json`; content = exportCollection(col); }
    const res = await window.api.exportFile({ defaultName, content });
    if (res.ok) showToast('已导出：' + res.filePath, 'success');
    else if (!res.canceled) showToast('导出失败：' + res.error, 'error');
  };
  const handleExportAll = async () => {
    if (ioBusyRef.current) return;
    ioBusyRef.current = true;
    try {
      const res = await window.api.exportFile({ defaultName: 'reqmock-workspace.json', content: exportWorkspace(collections, environments) });
      if (res.ok) showToast('已导出：' + res.filePath, 'success');
      else if (!res.canceled) showToast('导出失败：' + res.error, 'error');
    } finally { ioBusyRef.current = false; }
  };
  const handleExportEnv = async (env) => {
    if (ioBusyRef.current) return;
    ioBusyRef.current = true;
    try {
      const isGlobals = env.id === '__globals__';
      const res = await window.api.exportFile({ defaultName: isGlobals ? '全局变量.reqmock-env.json' : `${env.name || '环境'}.reqmock-env.json`, content: isGlobals ? exportEnvironments([], env.variables) : exportEnvironment(env) });
      if (res.ok) showToast('已导出：' + res.filePath, 'success');
      else if (!res.canceled) showToast('导出失败：' + res.error, 'error');
    } finally { ioBusyRef.current = false; }
  };
  const handleExportAllEnvs = async () => {
    if (environments.length === 0 && globals.filter((v) => v.key).length === 0) { showToast('暂无环境或全局变量可导出', 'warn'); return; }
    if (ioBusyRef.current) return;
    ioBusyRef.current = true;
    try {
      const res = await window.api.exportFile({ defaultName: 'reqmock-environments.json', content: exportEnvironments(environments, globals) });
      if (res.ok) showToast('已导出：' + res.filePath, 'success');
      else if (!res.canceled) showToast('导出失败：' + res.error, 'error');
    } finally { ioBusyRef.current = false; }
  };
  const handleBackupData = async () => {
    if (ioBusyRef.current) return;
    ioBusyRef.current = true;
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const content = JSON.stringify({ reqmock: true, version: 1, type: 'backup', exportedAt: new Date().toISOString(), data: { collections, environments, activeEnvId, globals, history, mock, cookieJar, settings } }, null, 2);
      const res = await window.api.exportFile({ defaultName: `reqmock-backup-${stamp}.json`, content });
      if (res.ok) showToast('备份成功：' + res.filePath, 'success');
      else if (!res.canceled) showToast('备份失败：' + res.error, 'error');
    } finally { ioBusyRef.current = false; }
  };
  const handleRestoreBackup = async () => {
    if (ioBusyRef.current) return;
    ioBusyRef.current = true;
    try {
      const res = await window.api.importFile();
      if (!res.ok) { if (!res.canceled) showToast('读取备份失败：' + res.error, 'error'); return; }
      let backup;
      try { backup = JSON.parse(res.content); } catch (e) { showToast('恢复失败：不是合法的 JSON 文件', 'error'); return; }
      if (!backup || backup.reqmock !== true || backup.type !== 'backup' || !backup.data) { showToast('恢复失败：不是 ReqMock 备份文件', 'error'); return; }
      const d = backup.data;
      uiDispatch({
        type: UI_ACTIONS.SET_CONFIRM,
        payload: {
          title: '恢复备份', message: '恢复将覆盖当前全部数据（集合 / 环境 / 全局变量 / 历史 / Mock / Cookie / 设置）且不可撤销，确定继续？', danger: true,
          onConfirm: () => {
            appDispatch({ type: APP_ACTIONS.HYDRATE, payload: { collections: (d.collections || []).map(normalizeNode), environments: Array.isArray(d.environments) ? d.environments : [], activeEnvId: d.activeEnvId || null, history: Array.isArray(d.history) ? d.history : [], globals: Array.isArray(d.globals) ? d.globals : [] } });
            mockDispatch({ type: MOCK_ACTIONS.SET_MOCK, payload: d.mock && Array.isArray(d.mock.routes) ? d.mock : { port: 3600, routes: [] } });
            cookieDispatch({ type: COOKIE_ACTIONS.SET_JAR, payload: Array.isArray(d.cookieJar) ? pruneCookies(d.cookieJar) : [] });
            uiDispatch({ type: UI_ACTIONS.SET_SETTINGS, payload: d.settings });
            uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null });
            showToast('备份已恢复', 'success');
          }
        }
      });
    } finally { ioBusyRef.current = false; }
  };

  // ---- cURL 导入/复制 ----
  const handleCurlImport = (parsed) => {
    let name = '导入的请求';
    try { name = new URL(parsed.url).pathname || name; } catch (e) { /* 保持默认 */ }
    const request = normalizeOpenedRequest(normalizeRequest({ ...parsed, id: uuid(), name }));
    tabDispatch({ type: TAB_ACTIONS.ADD_TAB, payload: { tab: createTab(request) } });
    uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null });
    showToast('导入成功', 'success');
  };
  const handleCopyCurl = async () => {
    try { await navigator.clipboard.writeText(toCurl(activeRequest)); showToast('cURL 命令已复制到剪贴板', 'success'); }
    catch (e) { showToast('复制失败：' + e.message, 'error'); }
  };

  // ---- 其他联动 handler ----
  const handleExtractVariable = (value, suggestedName = 'extracted') => {
    uiDispatch({
      type: UI_ACTIONS.SET_PROMPT,
      payload: {
        title: '提取为变量', label: '变量名', defaultValue: suggestedName,
        onConfirm: (name) => {
          if (!name) return;
          const val = typeof value === 'string' ? value : JSON.stringify(value);
          if (activeEnvId) {
            appDispatch({ type: APP_ACTIONS.PERSIST_ENV_CHANGES, payload: { envSet: { [name]: val }, envUnset: [], activeEnvId } });
            showToast(`已写入环境变量 {{${name}}}`, 'success');
          } else {
            appDispatch({ type: APP_ACTIONS.UPSERT_GLOBAL_VAR, payload: { key: name, value: val } });
            showToast(`未激活环境，已写入全局变量 {{${name}}}`, 'success');
          }
        }
      }
    });
  };
  const handleSaveResponseBody = async () => {
    const resp = curTab.response;
    if (!resp || !resp.ok) return;
    if (ioBusyRef.current) return;
    ioBusyRef.current = true;
    try {
      const ct = (resp.headers && resp.headers['content-type']) || '';
      const extMap = [['application/json','.json'],['text/html','.html'],['xml','.xml'],['image/png','.png'],['image/jpeg','.jpg'],['image/gif','.gif'],['image/webp','.webp'],['image/svg','.svg'],['pdf','.pdf'],['text/csv','.csv']];
      const ext = (extMap.find(([k]) => ct.includes(k)) || [null, '.txt'])[1];
      let pathName = 'response';
      try { pathName = new URL(resp.finalUrl || (activeRequest && activeRequest.url)).pathname.split('/').filter(Boolean).pop() || 'response'; } catch (e) { /* 保持默认 */ }
      const defaultName = pathName.includes('.') ? pathName : pathName + ext;
      const res = resp.bodyBase64 ? await window.api.exportFile({ defaultName, content: resp.bodyBase64, encoding: 'base64' }) : await window.api.exportFile({ defaultName, content: resp.body || '' });
      if (res.ok) showToast('已保存：' + res.filePath, 'success');
      else if (!res.canceled) showToast('保存失败：' + res.error, 'error');
    } finally { ioBusyRef.current = false; }
  };
  const handleSaveExample = () => {
    const resp = curTab.response;
    if (!activeRequest || !resp || !resp.ok) { showToast('没有可保存的成功响应', 'warn'); return; }
    uiDispatch({
      type: UI_ACTIONS.SET_PROMPT,
      payload: {
        title: '保存为示例响应', label: '示例名称', defaultValue: `${resp.status} 示例`,
        onConfirm: (name) => {
          if (!name) return;
          const example = { id: uuid(), name, status: resp.status, contentType: (resp.headers && resp.headers['content-type']) || '', headers: resp.headers || {}, body: typeof resp.body === 'string' ? resp.body.slice(0, 200 * 1024) : '', savedAt: new Date().toISOString() };
          const req = { ...activeRequest, examples: [...(activeRequest.examples || []), example] };
          setActiveRequest(req);
          appDispatch({ type: APP_ACTIONS.UPSERT_REQUEST, payload: req });
          showToast('已保存示例响应，可在「示例」页签查看', 'success');
        }
      }
    });
  };
  const handleExampleToMock = (example) => {
    if (!activeRequest) return;
    let pathName = '/';
    try { pathName = new URL(activeRequest.url).pathname; } catch (e) { /* 保持默认 */ }
    const route = { ...newMockRoute(), name: `${activeRequest.method} ${pathName}（${example.name}）`, method: activeRequest.method, path: pathName, status: example.status, headers: example.contentType ? [{ key: 'Content-Type', value: example.contentType, enabled: true }] : [], body: example.body };
    mockDispatch({ type: MOCK_ACTIONS.ADD_ROUTE, payload: route });
    openPageTab('mock');
    showToast('已从示例生成 Mock 路由', 'success');
  };

  const buildRunnerCtx = () => ({
    collections, varMap, settings, cookieJar,
    send: async (payload) => {
      const result = await window.api.sendRequest(payload);
      const cookieOn = payload.cookieJarMode === 'on' || (payload.cookieJarMode !== 'off' && settings.cookiesEnabled);
      if (cookieOn && result.setCookies && result.setCookies.length > 0) {
        cookieDispatch({ type: COOKIE_ACTIONS.UPSERT_COOKIES, payload: { cookies: result.setCookies, url: result.finalUrl || payload.url } });
      }
      return result;
    }
  });

  // ---- 全局拖拽导入 ----
  const [dragImportOver, setDragImportOver] = useState(false);
  const applyImportRef = useRef(null);
  applyImportRef.current = applyImportContent;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const inDropZone = (e) => e.target instanceof Element && e.target.closest('.env-drop-zone');
    const onDragEnter = (e) => { if (!hasFiles(e)) return; depth++; if (!inDropZone(e)) setDragImportOver(true); };
    const onDragOver = (e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragImportOver(!inDropZone(e)); };
    const onDragLeave = () => { depth = Math.max(0, depth - 1); if (depth === 0) setDragImportOver(false); };
    const onDrop = async (e) => {
      depth = 0; setDragImportOver(false);
      if (!hasFiles(e) || inDropZone(e)) return;
      e.preventDefault();
      for (const file of Array.from(e.dataTransfer.files)) {
        try { applyImportRef.current(await file.text()); } catch (err) { /* 单个文件读取失败不阻断其余 */ }
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragenter', onDragEnter); window.removeEventListener('dragover', onDragOver); window.removeEventListener('dragleave', onDragLeave); window.removeEventListener('drop', onDrop); };
  }, []);

  // ---- 派生值 ----
  const breadcrumb = activeRequest ? findRequestPath(collections, activeRequest.id) : null;
  const settingsCollection = modal && modal.type === 'colSettings' ? findNode(collections, modal.colId) : null;

  // =========================================================
  // 渲染（布局骨架与原版保持一致）
  // =========================================================
  return (
    <div className="app">
      <TopBar
        environments={environments} activeEnvId={activeEnvId} globals={globals}
        onActivateEnv={(id) => appDispatch({ type: APP_ACTIONS.SET_ACTIVE_ENV, payload: id })}
        onOpenGlobals={() => openPageTab('env', { envId: '__globals__' })}
        onManageEnvs={() => { setActivity('env'); setPanelOpen(true); }}
        onNewRequest={handleNewTab} onNewWs={() => handleNewRealtimeTab('ws')} onNewSse={() => handleNewRealtimeTab('sse')}
        onNewMockRoute={() => { handleAddRoute(); openPageTab('mock'); }}
        onNewEnv={handleNewEnv} onImportCurl={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'curl' } })}
        onImportFile={handleImport} onExportAll={handleExportAll} onBackup={handleBackupData}
        onToggleLayout={() => handleChangeSettings({ layout: settings.layout === 'vertical' ? 'horizontal' : 'vertical' })}
        onToggleConsole={() => uiDispatch({ type: UI_ACTIONS.SET_CONSOLE_OPEN, payload: !consoleOpen })}
        onToggleSidebar={() => setPanelOpen((v) => !v)}
        onOpenPalette={() => uiDispatch({ type: UI_ACTIONS.SET_PALETTE_OPEN, payload: true })}
        onOpenMock={() => openPageTab('mock')} onOpenCookies={() => openPageTab('cookies')}
        onOpenTool={(tool) => openPageTab('tool', { tool })} onKbd={() => uiDispatch({ type: UI_ACTIONS.SET_KBD_OPEN, payload: true })}
        onOpenWelcome={() => openPageTab('welcome')} onCheckUpdate={handleCheckUpdate}
        onAbout={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'about' } })}
      />
      <div className="app-body">
        <Sidebar
          activity={activity} panelOpen={panelOpen} onActivity={handleActivity}
          collections={collections} environments={environments} activeEnvId={activeEnvId}
          history={history} mock={mock} mockRunning={mockRunning} selectedRouteId={selectedRouteId}
          cookieJar={cookieJar} curTab={curTab} globals={globals}
          activeRequestId={activeRequest ? activeRequest.id : null}
          onOpenRequest={handleOpenRequest} onOpenHistory={handleOpenHistoryItem}
          onDeleteHistory={handleDeleteHistoryItem} onClearHistory={handleClearHistory}
          onCopyHistoryCurl={handleCopyHistoryCurl} onMoveRequest={handleMoveRequest}
          onDeleteRequest={handleDeleteRequest} onNewRequest={handleNewTab}
          onNewCollection={handleNewCollection} onAddFolder={handleAddFolder}
          onRenameNode={handleRenameNode} onDeleteFolder={handleDeleteFolder}
          onDeleteCollection={handleDeleteCollection} onCollectionSettings={handleCollectionSettings}
          onOpenRunner={handleOpenRunner} onExportCollection={handleExportCollection}
          onImport={handleImport} onImportContent={applyImportContent} onExportAll={handleExportAll}
          onOpenEnv={(id) => openPageTab('env', { envId: id })} onNewEnv={handleNewEnv}
          onExportEnvs={handleExportAllEnvs}
          onSelectRoute={(id) => { mockDispatch({ type: MOCK_ACTIONS.SET_SELECTED_ROUTE, payload: id }); openPageTab('mock'); }}
          onAddRoute={() => { handleAddRoute(); openPageTab('mock'); }}
          onOpenMock={() => openPageTab('mock')} onOpenCookies={() => openPageTab('cookies')}
          onOpenTool={(tool) => openPageTab('tool', { tool })} settings={settings}
          onChangeSettings={handleChangeSettings}
          onOpenSettings={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'settings' } })}
          noticeUnread={noticeUnread} onToggleNotices={handleToggleNotices}
        />
        <div className="main-area">
          {curTab.sending && <div className="app-progress" aria-hidden="true"><span className="app-progress-bar" /></div>}
          <TabBar
            tabs={tabs} groups={tabGroups} activeTabId={curTab.id} tabMeta={tabMeta} isTabDirty={isTabDirty}
            onSelect={(id) => tabDispatch({ type: TAB_ACTIONS.SET_ACTIVE_TAB, payload: id })}
            onClose={handleCloseTab} onNew={handleNewTab}
            onNewWs={() => handleNewRealtimeTab('ws')} onNewSse={() => handleNewRealtimeTab('sse')}
            onNewGroup={handleNewGroup} onAssignGroup={handleAssignGroup}
            onLeaveGroup={handleLeaveGroup} onRenameGroup={handleRenameGroup}
            onRecolorGroup={handleRecolorGroup} onToggleGroupCollapse={handleToggleGroupCollapse}
            onUngroup={handleUngroup} onCloseGroup={handleCloseGroup}
            onTogglePinTab={handleTogglePinTab} onTogglePinGroup={handleTogglePinGroup}
          />
          <div className="page-body" ref={pageScope}>
            {curTab.kind === 'welcome' && (
              <WelcomePage version={appVersion} onNewRequest={handleNewTab}
                onOpenPalette={() => uiDispatch({ type: UI_ACTIONS.SET_PALETTE_OPEN, payload: true })}
                onOpenMock={() => openPageTab('mock')} onKbd={() => uiDispatch({ type: UI_ACTIONS.SET_KBD_OPEN, payload: true })}
                onOpenAbout={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'about' } })} />
            )}
            {curTab.kind === 'request' && (
              <>
                <div className="title-row">
                  <span className="req-title" title="点击重命名" onClick={handleRenameRequest}>
                    {activeRequest.name || '未命名请求'}<span className="req-title-edit"><JbIcon name="pencil" size={12} /></span>
                  </span>
                  {breadcrumb ? (
                    <span className="title-crumbs">{breadcrumb.map((seg, i) => (<React.Fragment key={i}>{i > 0 && <span className="crumb-sep">›</span>}<span className="crumb">{seg}</span></React.Fragment>))}</span>
                  ) : (<span className="title-unsaved">未保存到集合</span>)}
                  <span className="flex-spacer" />
                  <button className="btn-secondary btn-save-sm" title="保存请求 (Ctrl+S)" onClick={handleSaveRequest}>保存</button>
                </div>
                <RequestBar request={activeRequest} sending={curTab.sending} varNames={varNames} varMap={varMap} activeEnv={activeEnv} onChange={setActiveRequest} onSend={handleSend} onCancel={handleCancelSend} onToast={showToast} />
                <div className={`request-workspace layout-${settings.layout} ${focusResponse ? 'focus-mode' : ''}`} ref={workspaceRef} style={{ '--split-v': settings.splitV + '%', '--split-h': settings.splitH + '%' }}>
                  {!focusResponse && (
                    <>
                      <RequestEditor request={activeRequest} varNames={varNames} varMap={varMap} ownerCollection={findOwnerCollection(collections, activeRequest.id)} onChange={setActiveRequest} onExampleToMock={handleExampleToMock} headerPresets={settings.headerPresets} onChangeHeaderPresets={(p) => handleChangeSettings({ headerPresets: p })} />
                      <div className={`split-resizer ${settings.layout === 'horizontal' ? 'split-resizer-h' : 'split-resizer-v'} ${splitDrag ? 'dragging' : ''}`} title="拖拽调整分栏比例，双击复位" onMouseDown={handleSplitDown} onDoubleClick={() => handleChangeSettings({ splitV: 45, splitH: 50 })} />
                    </>
                  )}
                  <ResponsePanel response={curTab.response} sending={curTab.sending} scriptResult={curTab.scriptResult} onResponseToMock={handleResponseToMock} onSaveExample={handleSaveExample} onSaveBody={handleSaveResponseBody} onExtractVariable={handleExtractVariable} onToast={showToast} layout={settings.layout} onToggleLayout={() => handleChangeSettings({ layout: settings.layout === 'vertical' ? 'horizontal' : 'vertical' })} focused={focusResponse} onToggleFocus={() => setFocusResponse((v) => !v)} historyList={curTab.responseHistory || []} onSelectHistory={handleSelectHistory} onRetry={handleSend} onRetryNoSsl={handleRetryNoSsl} onOpenConsole={() => uiDispatch({ type: UI_ACTIONS.SET_CONSOLE_OPEN, payload: true })} />
                </div>
              </>
            )}
            {curTab.kind === 'mock' && (
              <MockPanel mock={mock} mockRunning={mockRunning} mockBusy={mockBusy} mockLogs={mockLogs} selectedRouteId={selectedRouteId} onPortChange={(port) => mockDispatch({ type: MOCK_ACTIONS.SET_PORT, payload: port })} onToggle={handleMockToggle} onUpdateRoute={handleUpdateRoute} onDeleteRoute={handleDeleteRoute} onRouteToRequest={handleRouteToRequest} onClearLogs={() => mockDispatch({ type: MOCK_ACTIONS.CLEAR_MOCK_LOGS })} />
            )}
            {curTab.kind === 'ws' && (
              <WsPanel tabId={curTab.id} config={curTab.config || {}} state={rtState[curTab.id]} varNames={varNames} varMap={varMap} onChangeConfig={(config) => patchTab(curTab.id, { config })} onClear={() => mockDispatch({ type: MOCK_ACTIONS.CLEAR_RT_STATE, payload: curTab.id })} onToast={showToast} />
            )}
            {curTab.kind === 'sse' && (
              <SsePanel tabId={curTab.id} config={curTab.config || {}} state={rtState[curTab.id]} varNames={varNames} varMap={varMap} onChangeConfig={(config) => patchTab(curTab.id, { config })} onClear={() => mockDispatch({ type: MOCK_ACTIONS.CLEAR_RT_STATE, payload: curTab.id })} onToast={showToast} />
            )}
            {curTab.kind === 'cookies' && (
              <CookiePanel jar={cookieJar} cookiesEnabled={settings.cookiesEnabled} onChangeJar={(jar) => cookieDispatch({ type: COOKIE_ACTIONS.SET_JAR, payload: jar })} onToggleEnabled={(v) => handleChangeSettings({ cookiesEnabled: v })} />
            )}
            {curTab.kind === 'tool' && <ToolsPanel tool={curTab.tool} />}
            {curTab.kind === 'runner' && <RunnerPanel nodeId={curTab.nodeId} collections={collections} buildCtx={buildRunnerCtx} onToast={showToast} />}
            {curTab.kind === 'env' && (
              curTab.envId === '__globals__' ? (
                <EnvironmentPanel environment={{ id: '__globals__', name: '全局变量', variables: globals }} isGlobal activeEnv={activeEnv} onChange={(env) => appDispatch({ type: APP_ACTIONS.SET_GLOBALS, payload: env.variables })} onExport={handleExportEnv} />
              ) : (
                <EnvironmentPanel environment={environments.find((e) => e.id === curTab.envId) || null} isActive={curTab.envId === activeEnvId} globals={globals} onChange={handleUpdateEnv} onDelete={handleDeleteEnv} onActivate={(id) => appDispatch({ type: APP_ACTIONS.SET_ACTIVE_ENV, payload: id })} onExport={handleExportEnv} />
              )
            )}
          </div>
        </div>
        <UtilBar isRequestTab={curTab.kind === 'request'} request={activeRequest} onChangeRequest={setActiveRequest} onCodegen={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'codegen' } })} onCopyCurl={handleCopyCurl} varMap={varMap} activeEnvName={activeEnv ? activeEnv.name : ''} />
      </div>

      {/* 底部控制台抽屉 */}
      <AnimatePresence initial={false}>
        {consoleOpen && (
          <motion.div className="console-wrap" initial={{ height: 0 }} animate={{ height: 220 }} exit={{ height: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
            <ConsolePanel requestLogs={consoleLogs} scriptLogs={scriptLogs} mockLogs={mockLogs} onClearRequests={() => uiDispatch({ type: UI_ACTIONS.CLEAR_CONSOLE_LOGS })} onClearScripts={() => uiDispatch({ type: UI_ACTIONS.CLEAR_SCRIPT_LOGS })} onClearMock={() => mockDispatch({ type: MOCK_ACTIONS.CLEAR_MOCK_LOGS })} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_CONSOLE_OPEN, payload: false })} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 底部状态栏 */}
      <div className="status-bar">
        <span className={`status-item status-clickable ${mockRunning ? 'status-item-on' : ''}`} title={mockRunning ? `Mock 服务运行中（端口 ${mock.port}），点击打开服务面板` : 'Mock 服务未启动，点击打开服务面板'} onClick={() => openPageTab('mock')}><span className={`status-dot ${mockRunning ? 'on' : ''}`} />{mockRunning ? `Mock :${mock.port}` : 'Mock 未启动'}</span>
        <span className={`status-item ${activeEnvId ? 'status-clickable' : ''}`} title="当前激活环境" onClick={() => activeEnvId && openPageTab('env', { envId: activeEnvId })}><JbIcon name="earth" size={12} /> {activeEnv ? activeEnv.name : '无环境'}</span>
        <span className={`status-item status-clickable ${consoleOpen ? 'status-item-on' : ''}`} title="打开/关闭控制台" onClick={() => uiDispatch({ type: UI_ACTIONS.SET_CONSOLE_OPEN, payload: !consoleOpen })}><JbIcon name="terminal" size={12} /> 控制台</span>
        <span className="flex-spacer" />
        {updateProgress != null && <span className="status-item status-item-on" title="正在下载新版本安装包"><JbIcon name="update" size={12} /> 更新下载 {updateProgress}%</span>}
        {curTab.kind === 'request' && curTab.sending && <span className="status-item status-item-on">发送中…</span>}
        {curTab.kind === 'request' && !curTab.sending && curTab.response && curTab.response.ok && (
          <span className="status-item" title={curTab.response.timings ? (['dns:DNS','connect:TCP','tls:TLS','ttfb:首字节','download:下载'].map((s) => { const [k,label] = s.split(':'); return curTab.response.timings[k] != null ? `${label} ${curTab.response.timings[k]}ms` : null; }).filter(Boolean).join(' · ') || undefined) : undefined}>{curTab.response.status} · {curTab.response.timeMs} ms · {formatKb(curTab.response.sizeBytes)}</span>
        )}
        {curTab.kind === 'request' && !curTab.sending && curTab.response && !curTab.response.ok && <span className="status-item status-item-err">请求失败</span>}
        <span className="status-item" title="打开的标签数">{tabs.length} 标签</span>
        {appVersion && <span className="status-item status-clickable status-version" title="关于 ReqMock" onClick={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'about' } })}>v{appVersion}</span>}
        <span className="status-item status-clickable" title="快捷键速查" data-kbd-toggle onClick={() => uiDispatch({ type: UI_ACTIONS.SET_KBD_OPEN, payload: !kbdOpen })}><JbIcon name="quick-guide" size={12} /></span>
      </div>

      {/* 快捷键速查弹层 */}
      <AnimatePresence>
        {kbdOpen && (
          <motion.div className="kbd-popover" {...popoverRise}>
            <div className="kbd-title">快捷键</div>
            {SHORTCUTS.map(([label, keys]) => (<div key={label} className="kbd-row"><span>{label}</span><span className="kbd-key">{keys}</span></div>))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 命令面板 */}
      {paletteOpen && (
        <CommandPalette collections={collections} environments={environments} history={history} mock={mock} activeEnvId={activeEnvId} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_PALETTE_OPEN, payload: false })} onOpenRequest={handleOpenRequest} onOpenEnv={(id) => openPageTab('env', { envId: id })} onSelectRoute={(id) => { mockDispatch({ type: MOCK_ACTIONS.SET_SELECTED_ROUTE, payload: id }); openPageTab('mock'); }} onOpenTool={(tool) => openPageTab('tool', { tool })} onNewTab={handleNewTab} onNewWs={() => handleNewRealtimeTab('ws')} onNewSse={() => handleNewRealtimeTab('sse')} onOpenMock={() => openPageTab('mock')} onOpenCookies={() => openPageTab('cookies')} onOpenSettings={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: { type: 'settings' } })} onActivateEnv={(id) => appDispatch({ type: APP_ACTIONS.SET_ACTIVE_ENV, payload: id })} />
      )}

      {/* 弹窗层 */}
      {modal && modal.type === 'save' && <SaveRequestModal collections={collections} defaultName={activeRequest ? activeRequest.name : ''} onConfirm={handleSaveConfirm} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null })} />}
      {modal && modal.type === 'curl' && <CurlImportModal onConfirm={handleCurlImport} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null })} />}
      {modal && modal.type === 'codegen' && activeRequest && <CodegenModal request={applyAuth(resolveRequest(activeRequest, varMap))} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null })} />}
      {modal && modal.type === 'settings' && <SettingsModal settings={settings} onChange={handleChangeSettings} onBackup={handleBackupData} onRestore={handleRestoreBackup} onCheckUpdate={handleCheckUpdate} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null })} />}
      {modal && modal.type === 'about' && <AboutModal version={appVersion} onCheckUpdate={handleCheckUpdate} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null })} />}
      {modal && modal.type === 'exportCol' && (() => { const col = collections.find((c) => c.id === modal.colId); return col ? <ExportCollectionModal collection={col} onConfirm={handleExportColConfirm} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null })} /> : null; })()}
      {prompt && <PromptModal title={prompt.title} label={prompt.label} defaultValue={prompt.defaultValue} onConfirm={(value) => { uiDispatch({ type: UI_ACTIONS.SET_PROMPT, payload: null }); prompt.onConfirm(value); }} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_PROMPT, payload: null })} />}
      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} danger={confirm.danger} onConfirm={() => { uiDispatch({ type: UI_ACTIONS.SET_CONFIRM, payload: null }); confirm.onConfirm(); }} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_CONFIRM, payload: null })} />}
      {settingsCollection && <CollectionSettingsModal collection={settingsCollection} onConfirm={(patch) => handleSettingsConfirm(modal.colId, patch)} onClose={() => uiDispatch({ type: UI_ACTIONS.SET_MODAL, payload: null })} />}

      {/* 通知中心弹出层 */}
      <AnimatePresence>
        {noticesOpen && (
          <motion.div className="notice-popover" {...popoverRise}>
            <div className="notice-header"><span>通知中心</span><span className="notice-actions"><button className="btn-text" onClick={() => uiDispatch({ type: UI_ACTIONS.CLEAR_NOTICES })}>清空</button><button className="btn-text" onClick={() => uiDispatch({ type: UI_ACTIONS.SET_NOTICES_OPEN, payload: false })}><JbIcon name="close" size={12} /></button></span></div>
            <div className="notice-list">{notices.length === 0 && <div className="notice-empty">暂无通知</div>}{notices.map((n) => (<div key={n.id} className={`notice-item notice-${n.type}`}><div className="notice-text">{n.text}</div><div className="notice-time">{new Date(n.time).toLocaleTimeString()}</div></div>))}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div className={`toast toast-${toast.type}`} {...toastSlide}>
            <span className="toast-icon"><JbIcon name={toast.type === 'success' ? 'checkmark' : toast.type === 'error' ? 'close' : toast.type === 'warn' ? 'warning' : 'info'} size={14} /></span>
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 全局拖拽导入遮罩 */}
      {dragImportOver && (
        <div className="drag-import-overlay"><div className="drag-import-box"><div className="drag-import-icon">⤓</div><div>松开即导入集合 / 环境文件</div><div className="drag-import-sub">支持 ReqMock / Postman / OpenAPI / Insomnia / HAR / Hoppscotch</div></div></div>
      )}
    </div>
  );
}
