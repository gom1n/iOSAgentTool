const { contextBridge } = require('electron')

// 필요 시 여기서 renderer에 API 노출
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
})
