const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow = null;
let gameProcess = null;
let ipcServer = null;
let gameSocket = null;
let settings = {};

// IPC pipe name for communication with game
const PIPE_NAME = '\\\\.\\pipe\\fallout1mp';

// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
    settings = {};
  }
  return settings;
}

function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Find game executable in multiple possible locations
function findGamePath() {
  // If user has configured a custom path, use that first
  if (settings.gamePath && fs.existsSync(settings.gamePath)) {
    return settings.gamePath;
  }

  const possiblePaths = [
    // Same directory as launcher
    path.join(path.dirname(app.getPath('exe')), 'fallout-re.exe'),
    path.join(path.dirname(app.getPath('exe')), 'game', 'fallout-re.exe'),
    // Resources directory (packaged app)
    app.isPackaged ? path.join(process.resourcesPath, 'game', 'fallout-re.exe') : null,
    app.isPackaged ? path.join(process.resourcesPath, 'fallout-re.exe') : null,
    // Development paths
    path.join(__dirname, '..', '..', 'build-win32', 'Release', 'fallout-re.exe'),
    path.join(__dirname, '..', '..', 'build', 'Release', 'fallout-re.exe'),
    // Common install locations
    path.join(app.getPath('userData'), '..', 'Fallout1-RE', 'fallout-re.exe'),
  ].filter(Boolean);

  for (const p of possiblePaths) {
    console.log('Checking game path:', p);
    if (fs.existsSync(p)) {
      console.log('Found game at:', p);
      return p;
    }
  }

  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    resizable: false,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0a0a12'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopGame();
  });
}

// Create named pipe server for game communication
function createIPCServer() {
  return new Promise((resolve, reject) => {
    ipcServer = net.createServer((socket) => {
      console.log('Game connected to IPC');
      gameSocket = socket;

      socket.on('data', (data) => {
        try {
          const messages = data.toString().split('\n').filter(m => m.trim());
          messages.forEach(msg => {
            const parsed = JSON.parse(msg);
            handleGameMessage(parsed);
          });
        } catch (e) {
          console.error('Failed to parse game message:', e);
        }
      });

      socket.on('close', () => {
        console.log('Game disconnected from IPC');
        gameSocket = null;
      });

      socket.on('error', (err) => {
        console.error('Game socket error:', err);
      });
    });

    ipcServer.listen(PIPE_NAME, () => {
      console.log('IPC server listening on', PIPE_NAME);
      resolve();
    });

    ipcServer.on('error', (err) => {
      console.error('IPC server error:', err);
      reject(err);
    });
  });
}

function handleGameMessage(message) {
  // Forward game events to renderer
  if (mainWindow) {
    mainWindow.webContents.send('game-event', message);
  }

  switch (message.type) {
    case 'ready':
      console.log('Game is ready');
      break;
    case 'state-update':
      // Forward to multiplayer server
      break;
    case 'action':
      // Forward player action to server
      break;
  }
}

function sendToGame(message) {
  if (gameSocket) {
    gameSocket.write(JSON.stringify(message) + '\n');
  }
}

// Launch the game executable
async function launchGame(sessionInfo) {
  const gamePath = findGamePath();

  if (!gamePath) {
    throw new Error('Game executable not found. Please configure the game path in Settings.');
  }

  console.log('Launching game from:', gamePath);

  let args = [];

  if (sessionInfo.singleplayer) {
    // Singleplayer mode - no IPC needed
    console.log('Launching in singleplayer mode');
  } else {
    // Multiplayer mode - set up IPC
    console.log('Launching in multiplayer mode');
    try {
      await createIPCServer();
    } catch (e) {
      console.error('Failed to create IPC server:', e);
    }

    args = [
      '-multiplayer',
      '-pipe', PIPE_NAME,
      '-session', sessionInfo.sessionId,
      '-player', sessionInfo.participantId
    ];
  }

  // Launch game
  gameProcess = spawn(gamePath, args, {
    cwd: path.dirname(gamePath),
    stdio: 'pipe'
  });

  gameProcess.stdout.on('data', (data) => {
    console.log('[Game]', data.toString());
  });

  gameProcess.stderr.on('data', (data) => {
    console.error('[Game Error]', data.toString());
  });

  gameProcess.on('error', (err) => {
    console.error('Failed to start game:', err);
    if (mainWindow) {
      mainWindow.webContents.send('game-error', { error: err.message });
    }
  });

  gameProcess.on('close', (code) => {
    console.log('Game exited with code:', code);
    gameProcess = null;
    if (ipcServer) {
      ipcServer.close();
      ipcServer = null;
    }
    if (mainWindow) {
      mainWindow.webContents.send('game-closed', { code });
    }
  });

  return { success: true, gamePath };
}

function stopGame() {
  if (gameProcess) {
    gameProcess.kill();
    gameProcess = null;
  }
  if (ipcServer) {
    ipcServer.close();
    ipcServer = null;
  }
}

// IPC handlers from renderer
ipcMain.handle('launch-game', async (event, sessionInfo) => {
  try {
    return await launchGame(sessionInfo);
  } catch (err) {
    throw err;
  }
});

ipcMain.handle('stop-game', () => {
  stopGame();
  return true;
});

ipcMain.handle('send-to-game', (event, message) => {
  sendToGame(message);
  return true;
});

ipcMain.handle('get-game-status', () => {
  return {
    running: gameProcess !== null,
    connected: gameSocket !== null
  };
});

ipcMain.handle('get-game-path', () => {
  return findGamePath();
});

ipcMain.handle('browse-game-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Fallout Game Executable',
    filters: [{ name: 'Executable', extensions: ['exe'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const gamePath = result.filePaths[0];
    saveSettings({ gamePath });
    return gamePath;
  }
  return null;
});

ipcMain.handle('get-settings', () => {
  return settings;
});

ipcMain.handle('save-settings', (event, newSettings) => {
  saveSettings(newSettings);
  return true;
});

ipcMain.handle('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.handle('close-window', () => {
  mainWindow?.close();
});

app.whenReady().then(() => {
  loadSettings();
  createWindow();
});

app.on('window-all-closed', () => {
  stopGame();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
