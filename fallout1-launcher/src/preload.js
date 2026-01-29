const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  // Game control
  launchGame: (sessionInfo) => ipcRenderer.invoke('launch-game', sessionInfo),
  stopGame: () => ipcRenderer.invoke('stop-game'),
  sendToGame: (message) => ipcRenderer.invoke('send-to-game', message),
  getGameStatus: () => ipcRenderer.invoke('get-game-status'),
  getGamePath: () => ipcRenderer.invoke('get-game-path'),
  browseGamePath: () => ipcRenderer.invoke('browse-game-path'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Window control
  minimize: () => ipcRenderer.invoke('minimize-window'),
  close: () => ipcRenderer.invoke('close-window'),

  // Event listeners
  onGameEvent: (callback) => {
    ipcRenderer.on('game-event', (event, data) => callback(data));
  },
  onGameClosed: (callback) => {
    ipcRenderer.on('game-closed', (event, data) => callback(data));
  },
  onGameError: (callback) => {
    ipcRenderer.on('game-error', (event, data) => callback(data));
  }
});
