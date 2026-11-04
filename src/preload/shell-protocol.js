'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('xiaoxiaoyun', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  addAccount: (payload) => ipcRenderer.invoke('account:add', payload),
  updateAccount: (id, payload) => ipcRenderer.invoke('account:update', id, payload),
  removeAccount: (id) => ipcRenderer.invoke('account:remove', id),
  setActiveAccount: (id) => ipcRenderer.invoke('account:setActive', id),
  reload: () => ipcRenderer.invoke('view:reload'),
  loginNow: () => ipcRenderer.invoke('view:login-now'),
  setOverlay: (open) => ipcRenderer.invoke('view:overlay', open),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  onState: (handler) => {
    const listener = (_event, state) => handler(state)
    ipcRenderer.on('state:update', listener)
    return () => ipcRenderer.removeListener('state:update', listener)
  },
  onLoginResult: (handler) => {
    const listener = (_event, result) => handler(result)
    ipcRenderer.on('login:result', listener)
    return () => ipcRenderer.removeListener('login:result', listener)
  }
})
