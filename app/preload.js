'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mpageHost', {
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  pickFile: () => ipcRenderer.invoke('dialog:open'),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  readFolder: (path) => ipcRenderer.invoke('folder:read', path),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  exportFile: (opts) => ipcRenderer.invoke('file:export', opts),
  examplePath: () => ipcRenderer.invoke('example:path'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  setTitle: (t) => ipcRenderer.send('title', t),
  setLanguage: (lang) => ipcRenderer.send('lang', lang),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, p) => cb(p)),
});
