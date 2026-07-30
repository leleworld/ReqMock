/**
 * preload：以 contextBridge 暴露受控 API 给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 请求客户端
  sendRequest: (payload) => ipcRenderer.invoke('request:send', payload),
  cancelRequest: (token) => ipcRenderer.invoke('request:cancel', token),

  // 持久化
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (state) => ipcRenderer.invoke('store:save', state),

  // Mock 服务
  startMock: (config) => ipcRenderer.invoke('mock:start', config),
  stopMock: () => ipcRenderer.invoke('mock:stop'),
  mockStatus: () => ipcRenderer.invoke('mock:status'),
  updateMockRoutes: (routes) => ipcRenderer.invoke('mock:updateRoutes', routes),

  // WebSocket / SSE 实时连接
  wsConnect: (config) => ipcRenderer.invoke('ws:connect', config),
  wsSend: (id, data) => ipcRenderer.invoke('ws:send', { id, data }),
  wsClose: (id) => ipcRenderer.invoke('ws:close', id),
  sseConnect: (config) => ipcRenderer.invoke('sse:connect', config),
  sseClose: (id) => ipcRenderer.invoke('sse:close', id),
  onWsEvent: (callback) => {
    const listener = (event, evt) => callback(evt);
    ipcRenderer.on('ws:event', listener);
    return () => ipcRenderer.removeListener('ws:event', listener);
  },
  onSseEvent: (callback) => {
    const listener = (event, evt) => callback(evt);
    ipcRenderer.on('sse:event', listener);
    return () => ipcRenderer.removeListener('sse:event', listener);
  },

  // 文件导入导出
  exportFile: (payload) => ipcRenderer.invoke('file:export', payload),
  importFile: () => ipcRenderer.invoke('file:import'),

  // 选择本地文件（multipart 上传）与新建窗口
  pickFile: () => ipcRenderer.invoke('file:pick'),
  newWindow: () => ipcRenderer.invoke('window:new'),
  onMockLog: (callback) => {
    const listener = (event, entry) => callback(entry);
    ipcRenderer.on('mock:log', listener);
    return () => ipcRenderer.removeListener('mock:log', listener);
  },

  // 脚本外部编辑器（VSCode）：打开/关闭 + 保存回传监听
  openScriptExternal: (payload) => ipcRenderer.invoke('script:openExternal', payload),
  closeScriptExternal: (token) => ipcRenderer.invoke('script:closeExternal', token),
  onScriptChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('script:changed', listener);
    return () => ipcRenderer.removeListener('script:changed', listener);
  },

  // 自动更新：检查/下载/重启安装 + 进度事件监听
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (callback) => {
    const listener = (event, evt) => callback(evt);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  }
});
