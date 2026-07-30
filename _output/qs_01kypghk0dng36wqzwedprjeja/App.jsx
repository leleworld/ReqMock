import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, MotionConfig, useAnimate } from 'framer-motion';
import { toastSlide, popoverRise } from './utils/motionPresets.js';
import Sidebar from './components/Sidebar.jsx';
import TabBar from './components/TabBar.jsx';
import RequestEditor, { RequestBar } from './components/RequestEditor.jsx';
import ResponsePanel from './components/ResponsePanel.jsx';
import MockPanel from './components/MockPanel.jsx';
import CookiePanel from './components/CookiePanel.jsx';
import ToolsPanel, { TOOLS } from './components/ToolsPanel.jsx';
import RunnerPanel from './components/RunnerPanel.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { normalizeOpenedRequest } from './utils/urlSync.js';
import { executeRequest } from './utils/requestPipeline.js';
import EnvironmentPanel from './components/EnvironmentPanel.jsx';
import {
  SaveRequestModal, CollectionSettingsModal, CurlImportModal,
  CodegenModal, ExportCollectionModal, SettingsModal
} from './components/Modals.jsx';
import {
  newCollection, newFolder, normalizeNode, normalizeRequest,
  updateNode, removeNode, findNode,
  upsertRequestById, removeRequestById, findRequestPath,
  exportCollection, exportWorkspace, parseImport
} from './utils/collectionUtil.js';
import { newEnvironment, buildVarMap, resolveRequest } from './utils/envUtil.js';
import { applyAutoGroups, pickGroupColor, reorderTabsByGroup } from './utils/tabGroupUtil.js';
import { applyAuth } from './utils/authUtil.js';
import { toCurl } from './utils/curlUtil.js';
import { upsertCookies, pruneCookies } from './utils/cookieUtil.js';
import { normalizeSettings, applyTheme } from './utils/themeUtil.js';
import { exportPostmanCollection, exportMarkdownDocs } from './utils/exportUtil.js';

function uuid() {
  return crypto.randomUUID();
}

export function newRequest() {
  return normalizeRequest({ id: uuid() });
}

/** 新建一个请求标签页（每个标签独立持有请求/响应/脚本结果/发送状态） */
function createTab(request) {
  return { id: uuid(), kind: 'request', request, response: null, scriptResult: null, sending: false };
}

/** 判断是否为未编辑过的空白请求，打开请求时可直接复用该标签 */
function isBlankRequest(req) {
  return !req.url && req.bodyType === 'none' && !req.body &&
    (req.params || []).length === 0 && (req.headers || []).length === 0 &&
    (!req.name || req.name === '未命名请求');
}

/** 状态栏响应体积展示 */
function formatKb(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function newMockRoute() {
  return {
    id: uuid(),
    name: '新建路由',
    method: 'GET',
    path: '/api/example',
    status: 200,
    headers: [],
    body: '{\n  "message": "hello from mock"\n}',
    delayMs: 0,
    enabled: true
  };
}

const DEFAULT_STATE = {
  collections: [newCollection('默认集合')],
  environments: [],
  activeEnvId: null,
  history: [],
  mock: { port: 3600, routes: [] }
};

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [collections, setCollections] = useState(DEFAULT_STATE.collections);
  const [environments, setEnvironments] = useState(DEFAULT_STATE.environments);
  const [activeEnvId, setActiveEnvId] = useState(DEFAULT_STATE.activeEnvId);
  const [history, setHistory] = useState(DEFAULT_STATE.history);
  const [mock, setMock] = useState(DEFAULT_STATE.mock);
  const [cookieJar, setCookieJar] = useState([]);
  const [globals, setGlobals] = useState([]); // 全局变量（所有环境生效）
  const [settings, setSettings] = useState(() => normalizeSettings(null));

  const [activity, setActivity] = useState('collections'); // 活动栏当前项
  const [panelOpen, setPanelOpen] = useState(true); // 导航面板展开状态
  const [tabs, setTabs] = useState(() => [createTab(newRequest())]);
  const [tabGroups, setTabGroups] = useState([]); // 标签分组（Chrome 式）
  const [activeTabId, setActiveTabId] = useState(null);
  // 用户主动解散过的自动分组 urlKey，会话内不再自动重建
  const dismissedGroupKeysRef = useRef(new Set());

  const [mockRunning, setMockRunning] = useState(false);
  const [mockLogs, setMockLogs] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [toast, setToast] = useState(null);
  const [notices, setNotices] = useState([]); // 通知中心消息列表（会话级）
  const [noticeUnread, setNoticeUnread] = useState(0);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [modal, setModal] = useState(null); // {type:'save'} | {type:'colSettings', colId} | {type:'curl'}
  const [paletteOpen, setPaletteOpen] = useState(false); // Ctrl+K 全局搜索/命令面板

  // 当前激活标签页及其派生状态（仅请求类标签持有 request）
  const curTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const activeRequest = curTab.kind === 'request' ? curTab.request : null;

  const patchTab = useCallback((tabId, patch) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
  }, []);

  const setActiveRequest = (req) => patchTab(curTab.id, { request: req });

  /** 活动栏点击：同一项再次点击折叠/展开导航面板 */
  const handleActivity = (key) => {
    if (key === activity) setPanelOpen((v) => !v);
    else { setActivity(key); setPanelOpen(true); }
  };

  /** 打开单例页面标签（环境/Cookie/Mock/工具）：已打开则直接聚焦 */
  const openPageTab = (kind, extra = {}) => {
    const found = tabs.find((t) => t.kind === kind &&
      (kind !== 'env' || t.envId === extra.envId) &&
      (kind !== 'tool' || t.tool === extra.tool) &&
      (kind !== 'runner' || t.nodeId === extra.nodeId));
    if (found) {
      setActiveTabId(found.id);
      return;
    }
    const tab = { id: uuid(), kind, ...extra };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  /** 非请求标签的图标与名称（TabBar 用） */
  const tabMeta = (tab) => {
    if (tab.kind === 'env') {
      if (tab.envId === '__globals__') return { icon: '◈', label: '全局变量', title: '全局变量' };
      const env = environments.find((e) => e.id === tab.envId);
      return { icon: '◉', label: env ? env.name : '环境已删除', title: '环境变量' };
    }
    if (tab.kind === 'cookies') return { icon: '◍', label: 'Cookie 管理', title: 'Cookie 管理器' };
    if (tab.kind === 'mock') return { icon: '⇌', label: 'Mock 服务', title: 'Mock 服务面板' };
    if (tab.kind === 'tool') {
      const t = TOOLS.find((x) => x.key === tab.tool);
      return { icon: t ? t.icon : '⚒', label: t ? t.label : '工具', title: '工具箱' };
    }
    if (tab.kind === 'runner') {
      const node = findNode(collections, tab.nodeId);
      return { icon: '▶', label: node ? `运行 ${node.name}` : '批量运行', title: 'Collection Runner' };
    }
    return { icon: '□', label: '未知页面', title: '' };
  };

  // ---- 初始加载持久化数据（含旧版数据结构迁移） ----
  useEffect(() => {
    window.api.loadStore().then((saved) => {
      if (saved) {
        if (saved.collections) setCollections(saved.collections.map(normalizeNode));
        if (saved.environments) setEnvironments(saved.environments);
        if (saved.activeEnvId) setActiveEnvId(saved.activeEnvId);
        if (saved.history) setHistory(saved.history);
        if (saved.mock) setMock(saved.mock);
        if (Array.isArray(saved.cookieJar)) setCookieJar(pruneCookies(saved.cookieJar));
        if (Array.isArray(saved.globals)) setGlobals(saved.globals);
        const st = normalizeSettings(saved.settings);
        setSettings(st);
        applyTheme(st);
        if (Array.isArray(saved.openTabs) && saved.openTabs.length > 0) {
          const restored = saved.openTabs.map((t) => {
            // 页面类标签（环境/Cookie/Mock/工具）直接恢复标识
            if (t.kind && t.kind !== 'request') {
              return { id: t.id || uuid(), kind: t.kind, envId: t.envId, tool: t.tool, nodeId: t.nodeId, groupId: t.groupId };
            }
            return {
              ...createTab(normalizeOpenedRequest(normalizeRequest(t.request || {}))),
              id: t.id || uuid(),
              groupId: t.groupId
            };
          });
          setTabs(restored);
          if (Array.isArray(saved.tabGroups)) setTabGroups(saved.tabGroups);
          setActiveTabId(
            restored.some((t) => t.id === saved.activeTabId) ? saved.activeTabId : restored[0].id
          );
        }
      }
      setLoaded(true);
    });
    window.api.mockStatus().then((s) => setMockRunning(s.running));
    const unsubscribe = window.api.onMockLog((entry) => {
      setMockLogs((prev) => [entry, ...prev].slice(0, 200));
    });
    return unsubscribe;
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
            : { id: t.id, kind: t.kind, envId: t.envId, tool: t.tool, nodeId: t.nodeId, groupId: t.groupId }
        )),
        tabGroups,
        activeTabId: curTab.id
      });
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [loaded, collections, environments, activeEnvId, history, mock, cookieJar, globals, settings, tabs, tabGroups, activeTabId]);

  // ---- 自动分组：相同 URI 的请求标签自动归入同一分组（不干扰手动分组） ----
  useEffect(() => {
    if (!loaded) return;
    const r = applyAutoGroups(tabs, tabGroups, uuid, dismissedGroupKeysRef.current);
    if (r.changed) {
      setTabs(r.tabs);
      setTabGroups(r.groups);
    }
  }, [loaded, tabs, tabGroups]);

  // ---- Mock 运行中路由热更新 ----
  useEffect(() => {
    if (mockRunning) {
      window.api.updateMockRoutes(mock.routes);
    }
  }, [mockRunning, mock.routes]);

  /** 记录到通知中心（不弹 toast），type: info | success | error */
  const pushNotice = useCallback((text, type = 'info') => {
    setNotices((prev) => [{ id: uuid(), time: new Date().toISOString(), type, text }, ...prev].slice(0, 100));
    setNoticeUnread((n) => n + 1);
  }, []);

  const showToast = useCallback((text, type = 'info') => {
    setToast(text);
    setTimeout(() => setToast(null), 2500);
    pushNotice(text, type);
  }, [pushNotice]);

  const handleToggleNotices = () => {
    if (!noticesOpen) setNoticeUnread(0);
    setNoticesOpen(!noticesOpen);
  };

  // 通知中心打开后：点击弹层外部或按 Esc 自动关闭（✉ 按钮自身除外，避免关闭后又被切换重开）
  useEffect(() => {
    if (!noticesOpen) return;
    const onMouseDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.notice-popover') || e.target.closest('[data-notice-toggle]')) return;
      setNoticesOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setNoticesOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [noticesOpen]);

  // 切换标签/页面时重放主区入场动画：用 useAnimate 在原 DOM 上重放，不重挂载、保留子组件状态
  const [pageScope, animatePage] = useAnimate();
  useEffect(() => {
    if (!pageScope.current) return;
    animatePage(pageScope.current, { opacity: [0, 1], y: [5, 0] }, { duration: 0.16, ease: 'easeOut' });
  }, [curTab.id]);

  // ---- 环境相关 ----
  const activeEnv = environments.find((e) => e.id === activeEnvId) || null;
  const varNames = Object.keys(buildVarMap(activeEnv, globals));

  /** 修改应用设置（主题/强调色/Cookie 开关）并即时应用主题 */
  const handleChangeSettings = (patch) => {
    setSettings((prev) => {
      const next = normalizeSettings({ ...prev, ...patch });
      applyTheme(next);
      return next;
    });
  };

  /** 把脚本产生的环境变量变更写回激活环境 */
  const persistEnvChanges = useCallback(({ envSet, envUnset }) => {
    if (Object.keys(envSet).length === 0 && envUnset.length === 0) return;
    if (!activeEnvId) {
      showToast('未激活环境，脚本 rm.env.set 未持久化');
      return;
    }
    setEnvironments((prev) => prev.map((env) => {
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
    }));
  }, [activeEnvId, showToast]);

  const handleNewEnv = () => {
    const env = newEnvironment(`环境 ${environments.length + 1}`);
    setEnvironments((prev) => [...prev, env]);
    openPageTab('env', { envId: env.id });
  };

  const handleUpdateEnv = (env) => {
    setEnvironments((prev) => prev.map((e) => (e.id === env.id ? env : e)));
  };

  const handleDeleteEnv = (envId) => {
    if (!window.confirm('确定删除该环境？')) return;
    setEnvironments((prev) => prev.filter((e) => e.id !== envId));
    if (activeEnvId === envId) setActiveEnvId(null);
    // 同步关闭对应的环境标签页
    const envTab = tabs.find((t) => t.kind === 'env' && t.envId === envId);
    if (envTab) handleCloseTab(envTab.id);
  };

  // ---- 请求发送（管线见 utils/requestPipeline.js）----
  // 发送中的取消令牌：tabId -> cancelToken，用于发送中主动取消
  const sendTokensRef = useRef(new Map());
  const handleSend = async () => {
    if (curTab.kind !== 'request') return;
    const tabId = curTab.id;
    const reqSnapshot = curTab.request;
    if (!reqSnapshot.url) {
      showToast('请先填写 URL');
      return;
    }
    patchTab(tabId, { sending: true, response: null, scriptResult: null });

    // 注册取消令牌，发送中可点“取消”中断请求
    const cancelToken = uuid();
    sendTokensRef.current.set(tabId, cancelToken);
    const { result, finalReq, logs, tests, errors, envSet, envUnset, cookieOn } =
      await executeRequest(reqSnapshot, {
        collections,
        varMap: buildVarMap(activeEnv, globals),
        settings,
        cookieJar,
        send: (payload) => window.api.sendRequest(payload),
        cancelToken
      });
    sendTokensRef.current.delete(tabId);

    // 脚本产生的环境变量变更写回激活环境
    persistEnvChanges({ envSet, envUnset });

    // 记录响应中的 Set-Cookie 到 Cookie jar
    if (cookieOn && result.setCookies && result.setCookies.length > 0) {
      setCookieJar((jar) => upsertCookies(jar, result.setCookies, result.finalUrl || finalReq.url));
    }

    patchTab(tabId, {
      sending: false,
      response: result,
      scriptResult: tests.length || logs.length || errors.length ? { tests, logs, errors } : null
    });
    if (!result.ok) pushNotice(`请求失败 ${finalReq.url}：${result.error || '未知错误'}`, 'error');
    if (errors.length) pushNotice(`脚本异常（${reqSnapshot.name || finalReq.url}）：${errors.join('；')}`, 'error');
    setHistory((prev) => [{
      ...reqSnapshot,
      id: uuid(),
      time: new Date().toISOString(),
      status: result.ok ? result.status : 'ERR'
    }, ...prev].slice(0, 100));
  };

  /** 取消当前标签发送中的请求 */
  const handleCancelSend = () => {
    const token = sendTokensRef.current.get(curTab.id);
    if (token) window.api.cancelRequest(token);
  };

  // ---- 请求保存：已在集合中则原位更新，否则弹窗选择保存位置 ----
  const handleSaveRequest = () => {
    if (!activeRequest) return;
    const { tree, found } = upsertRequestById(collections, activeRequest);
    if (found) {
      setCollections(tree);
      showToast('已保存');
    } else {
      setModal({ type: 'save' });
    }
  };

  const handleSaveConfirm = (name, targetId) => {
    const req = { ...activeRequest, name };
    setActiveRequest(req);
    setCollections((prev) => updateNode(prev, targetId, (node) => ({
      ...node,
      requests: [...(node.requests || []), req]
    })));
    setModal(null);
    showToast('已保存到集合');
  };

  const handleOpenRequest = (req) => {
    // URL 带 query 而 Params 表为空时自动解析加载
    const request = normalizeOpenedRequest(normalizeRequest(req));
    // 已在某标签中打开则直接聚焦，保留标签内未保存的编辑
    const existing = tabs.find((t) => t.kind === 'request' && t.request.id === request.id);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    // 当前标签是空白请求则复用，否则新开标签
    if (curTab.kind === 'request' && isBlankRequest(curTab.request)) {
      patchTab(curTab.id, { request, response: null, scriptResult: null });
      setActiveTabId(curTab.id);
      return;
    }
    const tab = createTab(request);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  // ---- 标签页操作 ----
  const handleNewTab = () => {
    const tab = createTab(newRequest());
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const handleCloseTab = (tabId) => {
    const next = tabs.filter((t) => t.id !== tabId);
    if (next.length === 0) {
      // 关闭最后一个标签时自动新建空白标签
      const tab = createTab(newRequest());
      setTabs([tab]);
      setActiveTabId(tab.id);
      return;
    }
    setTabs(next);
    if (tabId === curTab.id) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      setActiveTabId(next[Math.max(0, idx - 1)].id);
    }
  };

  // ---- 标签分组操作（Chrome 式） ----
  /** 把标签加入新建的手动分组 */
  const handleNewGroup = (tabId) => {
    const name = window.prompt('分组名称：', '新分组');
    if (!name) return;
    const group = { id: uuid(), name, color: pickGroupColor(tabGroups), collapsed: false, auto: false };
    setTabGroups((prev) => [...prev, group]);
    setTabs((prev) => reorderTabsByGroup(prev.map((t) => (t.id === tabId ? { ...t, groupId: group.id } : t))));
  };

  /** 把标签加入已有分组；自动组被手动加人后转为手动组，避免被自动逻辑拆散 */
  const handleAssignGroup = (tabId, groupId) => {
    setTabGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, auto: false } : g)));
    setTabs((prev) => reorderTabsByGroup(prev.map((t) => (t.id === tabId ? { ...t, groupId } : t))));
  };

  /** 把标签移出分组；若原组是自动组则转手动，防止相同 URI 规则立刻把它拉回去 */
  const handleLeaveGroup = (tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.groupId) {
      setTabGroups((prev) => prev.map((g) => (g.id === tab.groupId ? { ...g, auto: false } : g)));
    }
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, groupId: undefined } : t)));
  };

  const handleRenameGroup = (groupId) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (!group) return;
    const name = window.prompt('分组名称：', group.name);
    if (!name || name === group.name) return;
    setTabGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));
  };

  const handleRecolorGroup = (groupId, color) => {
    setTabGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, color } : g)));
  };

  const handleToggleGroupCollapse = (groupId) => {
    setTabGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)));
  };

  /** 解散分组但保留标签；自动组记入 dismissed，会话内不再重建 */
  const handleUngroup = (groupId) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (group && group.auto && group.urlKey) dismissedGroupKeysRef.current.add(group.urlKey);
    setTabGroups((prev) => prev.filter((g) => g.id !== groupId));
    setTabs((prev) => prev.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)));
  };

  /** 关闭分组内全部标签 */
  const handleCloseGroup = (groupId) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (group && group.auto && group.urlKey) dismissedGroupKeysRef.current.add(group.urlKey);
    setTabGroups((prev) => prev.filter((g) => g.id !== groupId));
    const next = tabs.filter((t) => t.groupId !== groupId);
    if (next.length === 0) {
      const tab = createTab(newRequest());
      setTabs([tab]);
      setActiveTabId(tab.id);
      return;
    }
    setTabs(next);
    if (!next.some((t) => t.id === curTab.id)) setActiveTabId(next[0].id);
  };

  // ---- 快捷键（通过 ref 避免闭包过期） ----
  const hotkeysRef = useRef({});
  hotkeysRef.current = {
    send: handleSend,
    save: handleSaveRequest,
    newTab: handleNewTab,
    closeTab: () => handleCloseTab(curTab.id)
  };
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const h = hotkeysRef.current;
      if (k === 'enter') { e.preventDefault(); h.send(); }
      else if (k === 'k' || (k === 'p' && e.shiftKey)) { e.preventDefault(); setPaletteOpen((v) => !v); }
      else if (k === 's') { e.preventDefault(); h.save(); }
      else if (k === 't') { e.preventDefault(); h.newTab(); }
      else if (k === 'w') { e.preventDefault(); h.closeTab(); }
      else if (k === 'n' && e.shiftKey) { e.preventDefault(); window.api.newWindow(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- cURL 导入 / 导出 ----
  const handleCurlImport = (parsed) => {
    let name = '导入的请求';
    try {
      name = new URL(parsed.url).pathname || name;
    } catch (e) { /* 保持默认 */ }
    // URL 中的 query 同步到 Params 表
    const request = normalizeOpenedRequest(normalizeRequest({ ...parsed, id: uuid(), name }));
    const tab = createTab(request);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setModal(null);
    showToast('导入成功');
  };

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(toCurl(activeRequest));
      showToast('cURL 命令已复制到剪贴板');
    } catch (e) {
      showToast('复制失败：' + e.message, 'error');
    }
  };

  // ---- 集合树操作 ----
  const handleNewCollection = () => {
    const name = window.prompt('集合名称：', `集合 ${collections.length + 1}`);
    if (!name) return;
    setCollections((prev) => [...prev, newCollection(name)]);
  };

  const handleAddFolder = (parentId) => {
    const name = window.prompt('文件夹名称：', '新建文件夹');
    if (!name) return;
    setCollections((prev) => updateNode(prev, parentId, (node) => ({
      ...node,
      folders: [...(node.folders || []), newFolder(name)]
    })));
  };

  const handleRenameNode = (nodeId, currentName) => {
    const name = window.prompt('重命名：', currentName);
    if (!name || name === currentName) return;
    setCollections((prev) => updateNode(prev, nodeId, (node) => ({ ...node, name })));
  };

  const handleDeleteFolder = (folderId) => {
    if (!window.confirm('确定删除该文件夹及其中所有请求？')) return;
    setCollections((prev) => removeNode(prev, folderId));
  };

  const handleDeleteCollection = (colId) => {
    if (!window.confirm('确定删除该集合及其中所有请求？')) return;
    setCollections((prev) => prev.filter((c) => c.id !== colId));
  };

  const handleDeleteRequest = (reqId) => {
    setCollections((prev) => removeRequestById(prev, reqId));
  };

  const handleCollectionSettings = (colId) => setModal({ type: 'colSettings', colId });

  // ---- Collection Runner ----
  /** 打开批量运行标签（同一节点复用标签） */
  const handleOpenRunner = (nodeId) => openPageTab('runner', { nodeId });

  /** Runner 执行上下文：与单发共用管线，Set-Cookie 写回 Cookie jar */
  const buildRunnerCtx = () => ({
    collections,
    varMap: buildVarMap(activeEnv, globals),
    settings,
    cookieJar,
    send: async (payload) => {
      const result = await window.api.sendRequest(payload);
      const cookieOn = payload.cookieJarMode === 'on' ||
        (payload.cookieJarMode !== 'off' && settings.cookiesEnabled);
      if (cookieOn && result.setCookies && result.setCookies.length > 0) {
        setCookieJar((jar) => upsertCookies(jar, result.setCookies, result.finalUrl || payload.url));
      }
      return result;
    }
  });

  const handleSettingsConfirm = (colId, patch) => {
    setCollections((prev) => updateNode(prev, colId, (node) => ({ ...node, ...patch })));
    setModal(null);
    showToast('集合设置已保存');
  };

  // ---- 导入 / 导出 ----
  /** 解析导入文本并合入工作区（文件选择与拖拽导入共用） */
  const applyImportContent = (content) => {
    try {
      const { collections: cols, environments: envs } = parseImport(content);
      if (cols.length) setCollections((prev) => [...prev, ...cols]);
      if (envs.length) setEnvironments((prev) => [...prev, ...envs]);
      showToast(`导入成功：${cols.length} 个集合，${envs.length} 个环境`, 'success');
    } catch (e) {
      showToast('导入失败：' + e.message, 'error');
    }
  };

  const handleImport = async () => {
    const res = await window.api.importFile();
    if (!res.ok) {
      if (!res.canceled) showToast('导入失败：' + res.error, 'error');
      return;
    }
    applyImportContent(res.content);
  };

  // 导出集合：先弹窗选择格式（ReqMock / Postman / Markdown）
  const handleExportCollection = (colId) => setModal({ type: 'exportCol', colId });

  const handleExportColConfirm = async (format) => {
    const col = collections.find((c) => c.id === modal.colId);
    setModal(null);
    if (!col) return;
    let defaultName;
    let content;
    if (format === 'postman') {
      defaultName = `${col.name}.postman.json`;
      content = exportPostmanCollection(col);
    } else if (format === 'markdown') {
      defaultName = `${col.name}.md`;
      content = exportMarkdownDocs(col);
    } else {
      defaultName = `${col.name}.reqmock.json`;
      content = exportCollection(col);
    }
    const res = await window.api.exportFile({ defaultName, content });
    if (res.ok) showToast('已导出：' + res.filePath);
    else if (!res.canceled) showToast('导出失败：' + res.error, 'error');
  };

  const handleExportAll = async () => {
    const res = await window.api.exportFile({
      defaultName: 'reqmock-workspace.json',
      content: exportWorkspace(collections, environments)
    });
    if (res.ok) showToast('已导出：' + res.filePath);
    else if (!res.canceled) showToast('导出失败：' + res.error, 'error');
  };

  // ---- Mock 相关 ----
  const handleMockToggle = async () => {
    if (mockRunning) {
      await window.api.stopMock();
      setMockRunning(false);
      showToast('Mock 服务已停止');
    } else {
      const result = await window.api.startMock({ port: mock.port, routes: mock.routes });
      if (result.ok) {
        setMockRunning(true);
        showToast(`Mock 服务已启动: http://localhost:${mock.port}`, 'success');
      } else {
        showToast('启动失败: ' + result.error, 'error');
      }
    }
  };

  const handleAddRoute = () => {
    const route = newMockRoute();
    setMock((prev) => ({ ...prev, routes: [...prev.routes, route] }));
    setSelectedRouteId(route.id);
  };

  const handleUpdateRoute = (route) => {
    setMock((prev) => ({
      ...prev,
      routes: prev.routes.map((r) => (r.id === route.id ? route : r))
    }));
  };

  const handleDeleteRoute = (routeId) => {
    setMock((prev) => ({ ...prev, routes: prev.routes.filter((r) => r.id !== routeId) }));
    if (selectedRouteId === routeId) {
      setSelectedRouteId(null);
    }
  };

  /** 联动：当前响应一键转 Mock 路由 */
  const handleResponseToMock = () => {
    const response = curTab.response;
    if (!response || !response.ok) {
      showToast('没有可转换的成功响应');
      return;
    }
    let pathName = '/';
    try {
      pathName = new URL(response.finalUrl || activeRequest.url).pathname;
    } catch (e) { /* 保持默认 */ }
    const contentType = response.headers['content-type'] || 'application/json; charset=utf-8';
    const route = {
      ...newMockRoute(),
      name: `${activeRequest.method} ${pathName}`,
      method: activeRequest.method,
      path: pathName,
      status: response.status,
      headers: [{ key: 'Content-Type', value: contentType, enabled: true }],
      body: response.body
    };
    setMock((prev) => ({ ...prev, routes: [...prev.routes, route] }));
    setSelectedRouteId(route.id);
    openPageTab('mock');
    showToast('已生成 Mock 路由');
  };

  /** 联动：从 Mock 路由生成调试请求（新开标签） */
  const handleRouteToRequest = (route) => {
    const req = {
      ...newRequest(),
      name: route.name,
      method: route.method === 'ANY' ? 'GET' : route.method,
      url: `http://localhost:${mock.port}${route.path.replace(/:([\w-]+)/g, '1').replace(/\*/g, 'x')}`
    };
    const tab = createTab(req);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const settingsCollection = modal && modal.type === 'colSettings' ? findNode(collections, modal.colId) : null;

  // 面包屑：当前请求在集合树中的路径（未保存的请求不显示）
  const breadcrumb = activeRequest ? findRequestPath(collections, activeRequest.id) : null;

  return (
    <MotionConfig reducedMotion="user">
    <div className="app">
      <div className="app-body">
      <Sidebar
        activity={activity}
        panelOpen={panelOpen}
        onActivity={handleActivity}
        collections={collections}
        environments={environments}
        activeEnvId={activeEnvId}
        history={history}
        mock={mock}
        mockRunning={mockRunning}
        selectedRouteId={selectedRouteId}
        cookieJar={cookieJar}
        curTab={curTab}
        globals={globals}
        activeRequestId={activeRequest ? activeRequest.id : null}
        onOpenRequest={handleOpenRequest}
        onDeleteRequest={handleDeleteRequest}
        onNewRequest={handleNewTab}
        onNewCollection={handleNewCollection}
        onAddFolder={handleAddFolder}
        onRenameNode={handleRenameNode}
        onDeleteFolder={handleDeleteFolder}
        onDeleteCollection={handleDeleteCollection}
        onCollectionSettings={handleCollectionSettings}
        onOpenRunner={handleOpenRunner}
        onExportCollection={handleExportCollection}
        onImport={handleImport}
        onImportContent={applyImportContent}
        onExportAll={handleExportAll}
        onOpenEnv={(id) => openPageTab('env', { envId: id })}
        onNewEnv={handleNewEnv}
        onActivateEnv={setActiveEnvId}
        onSelectRoute={(id) => { setSelectedRouteId(id); openPageTab('mock'); }}
        onAddRoute={() => { handleAddRoute(); openPageTab('mock'); }}
        onOpenMock={() => openPageTab('mock')}
        onOpenCookies={() => openPageTab('cookies')}
        onOpenTool={(tool) => openPageTab('tool', { tool })}
        settings={settings}
        onChangeSettings={handleChangeSettings}
        onOpenSettings={() => setModal({ type: 'settings' })}
        noticeUnread={noticeUnread}
        onToggleNotices={handleToggleNotices}
      />
      <div className="main-area">
        <TabBar
          tabs={tabs}
          groups={tabGroups}
          activeTabId={curTab.id}
          tabMeta={tabMeta}
          onSelect={setActiveTabId}
          onClose={handleCloseTab}
          onNew={handleNewTab}
          onImportCurl={() => setModal({ type: 'curl' })}
          layout={settings.layout}
          onToggleLayout={() => handleChangeSettings({ layout: settings.layout === 'vertical' ? 'horizontal' : 'vertical' })}
          onNewGroup={handleNewGroup}
          onAssignGroup={handleAssignGroup}
          onLeaveGroup={handleLeaveGroup}
          onRenameGroup={handleRenameGroup}
          onRecolorGroup={handleRecolorGroup}
          onToggleGroupCollapse={handleToggleGroupCollapse}
          onUngroup={handleUngroup}
          onCloseGroup={handleCloseGroup}
        />
        <div className="page-body" ref={pageScope}>
        {curTab.kind === 'request' && (
          <>
            {breadcrumb && (
              <div className="breadcrumb">
                {breadcrumb.map((seg, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="crumb-sep">›</span>}
                    <span className="crumb">{seg}</span>
                  </React.Fragment>
                ))}
                <span className="crumb-sep">›</span>
                <span className="crumb crumb-cur">{activeRequest.name || '未命名请求'}</span>
              </div>
            )}
            {/* 全宽请求顶栏：不受下方分栏影响，URL 完整可见 */}
            <RequestBar
              request={activeRequest}
              sending={curTab.sending}
              varNames={varNames}
              onChange={setActiveRequest}
              onSend={handleSend}
              onCancel={handleCancelSend}
              onSave={handleSaveRequest}
              onCopyCurl={handleCopyCurl}
              onCodegen={() => setModal({ type: 'codegen' })}
            />
            <div className={`request-workspace layout-${settings.layout}`}>
              <RequestEditor
                request={activeRequest}
                varNames={varNames}
                onChange={setActiveRequest}
              />
              <ResponsePanel
                response={curTab.response}
                sending={curTab.sending}
                scriptResult={curTab.scriptResult}
                onResponseToMock={handleResponseToMock}
                onToast={showToast}
              />
            </div>
          </>
        )}
        {curTab.kind === 'mock' && (
          <MockPanel
            mock={mock}
            mockRunning={mockRunning}
            mockLogs={mockLogs}
            selectedRouteId={selectedRouteId}
            onPortChange={(port) => setMock((prev) => ({ ...prev, port }))}
            onToggle={handleMockToggle}
            onUpdateRoute={handleUpdateRoute}
            onDeleteRoute={handleDeleteRoute}
            onRouteToRequest={handleRouteToRequest}
            onClearLogs={() => setMockLogs([])}
          />
        )}
        {curTab.kind === 'cookies' && (
          <CookiePanel
            jar={cookieJar}
            cookiesEnabled={settings.cookiesEnabled}
            onChangeJar={setCookieJar}
            onToggleEnabled={(v) => handleChangeSettings({ cookiesEnabled: v })}
          />
        )}
        {curTab.kind === 'tool' && <ToolsPanel tool={curTab.tool} />}
        {curTab.kind === 'runner' && (
          <RunnerPanel
            nodeId={curTab.nodeId}
            collections={collections}
            buildCtx={buildRunnerCtx}
            onToast={showToast}
          />
        )}
        {curTab.kind === 'env' && (
          curTab.envId === '__globals__' ? (
            <EnvironmentPanel
              environment={{ id: '__globals__', name: '全局变量', variables: globals }}
              isGlobal
              onChange={(env) => setGlobals(env.variables)}
            />
          ) : (
            <EnvironmentPanel
              environment={environments.find((e) => e.id === curTab.envId) || null}
              isActive={curTab.envId === activeEnvId}
              onChange={handleUpdateEnv}
              onDelete={handleDeleteEnv}
              onActivate={setActiveEnvId}
            />
          )
        )}
        </div>
      </div>
      </div>

      {/* 底部状态栏：Mock 状态 / 激活环境 / 快捷键提示 / 当前响应摘要 */}
      <div className="status-bar">
        <span
          className={`status-item status-clickable ${mockRunning ? 'status-item-on' : ''}`}
          title={mockRunning ? `Mock 服务运行中（端口 ${mock.port}），点击打开服务面板` : 'Mock 服务未启动，点击打开服务面板'}
          onClick={() => openPageTab('mock')}
        >{mockRunning ? `● Mock :${mock.port}` : '○ Mock 未启动'}</span>
        <span
          className={`status-item ${activeEnvId ? 'status-clickable' : ''}`}
          title="当前激活环境"
          onClick={() => activeEnvId && openPageTab('env', { envId: activeEnvId })}
        >◉ {activeEnv ? activeEnv.name : '无环境'}</span>
        <span className="flex-spacer" />
        <span className="status-hint">Ctrl+Enter 发送 · Ctrl+K 全局搜索 · Ctrl+S 保存 · Ctrl+T 新标签</span>
        <span className="flex-spacer" />
        {curTab.kind === 'request' && curTab.sending && <span className="status-item status-item-on">发送中…</span>}
        {curTab.kind === 'request' && !curTab.sending && curTab.response && curTab.response.ok && (
          <span className="status-item">
            {curTab.response.status} · {curTab.response.timeMs} ms · {formatKb(curTab.response.sizeBytes)}
          </span>
        )}
        {curTab.kind === 'request' && !curTab.sending && curTab.response && !curTab.response.ok && (
          <span className="status-item status-item-err">请求失败</span>
        )}
        <span className="status-item" title="打开的标签数">{tabs.length} 标签</span>
      </div>

      {paletteOpen && (
        <CommandPalette
          collections={collections}
          environments={environments}
          history={history}
          mock={mock}
          activeEnvId={activeEnvId}
          onClose={() => setPaletteOpen(false)}
          onOpenRequest={handleOpenRequest}
          onOpenEnv={(id) => openPageTab('env', { envId: id })}
          onSelectRoute={(id) => { setSelectedRouteId(id); openPageTab('mock'); }}
          onOpenTool={(tool) => openPageTab('tool', { tool })}
          onNewTab={handleNewTab}
          onOpenMock={() => openPageTab('mock')}
          onOpenCookies={() => openPageTab('cookies')}
          onOpenSettings={() => setModal({ type: 'settings' })}
          onActivateEnv={setActiveEnvId}
        />
      )}

      {modal && modal.type === 'save' && (
        <SaveRequestModal
          collections={collections}
          defaultName={activeRequest ? activeRequest.name : ''}
          onConfirm={handleSaveConfirm}
          onClose={() => setModal(null)}
        />
      )}
      {modal && modal.type === 'curl' && (
        <CurlImportModal onConfirm={handleCurlImport} onClose={() => setModal(null)} />
      )}
      {modal && modal.type === 'codegen' && activeRequest && (
        <CodegenModal
          request={applyAuth(resolveRequest(activeRequest, buildVarMap(activeEnv, globals)))}
          onClose={() => setModal(null)}
        />
      )}
      {modal && modal.type === 'settings' && (
        <SettingsModal settings={settings} onChange={handleChangeSettings} onClose={() => setModal(null)} />
      )}
      {modal && modal.type === 'exportCol' && (() => {
        const col = collections.find((c) => c.id === modal.colId);
        return col ? (
          <ExportCollectionModal collection={col} onConfirm={handleExportColConfirm} onClose={() => setModal(null)} />
        ) : null;
      })()}
      {settingsCollection && (
        <CollectionSettingsModal
          collection={settingsCollection}
          onConfirm={(patch) => handleSettingsConfirm(modal.colId, patch)}
          onClose={() => setModal(null)}
        />
      )}

      <AnimatePresence>
        {noticesOpen && (
          <motion.div className="notice-popover" {...popoverRise}>
            <div className="notice-header">
            <span>通知中心</span>
            <span className="notice-actions">
              <button className="btn-text" onClick={() => { setNotices([]); setNoticeUnread(0); }}>清空</button>
              <button className="btn-text" onClick={() => setNoticesOpen(false)}>✕</button>
            </span>
            </div>
            <div className="notice-list">
              {notices.length === 0 && <div className="notice-empty">暂无通知</div>}
              {notices.map((n) => (
                <div key={n.id} className={`notice-item notice-${n.type}`}>
                  <div className="notice-text">{n.text}</div>
                  <div className="notice-time">{new Date(n.time).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && <motion.div className="toast" {...toastSlide}>{toast}</motion.div>}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}
