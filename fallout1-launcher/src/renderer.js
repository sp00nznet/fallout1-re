// State
let apiBase = localStorage.getItem('serverUrl') || 'http://localhost:3001';
let wsUrl = apiBase.replace('http', 'ws') + '/ws';
let accessToken = null;
let refreshToken = null;
let user = null;
let ws = null;
let currentGame = null;
let characters = [];
let selectedCharacter = null;
let playerName = localStorage.getItem('playerName') || 'Vault Dweller';
let isLanMode = false;

// Elements
const screens = {
  menu: document.getElementById('screen-menu'),
  mpMenu: document.getElementById('screen-mp-menu'),
  hostLan: document.getElementById('screen-host-lan'),
  joinLan: document.getElementById('screen-join-lan'),
  online: document.getElementById('screen-online'),
  browser: document.getElementById('screen-browser'),
  create: document.getElementById('screen-create'),
  room: document.getElementById('screen-room'),
  characters: document.getElementById('screen-characters'),
  settings: document.getElementById('screen-settings'),
  ingame: document.getElementById('screen-ingame')
};

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadSettings();
  loadStoredAuth();
});

function setupEventListeners() {
  // Titlebar
  document.getElementById('btn-minimize').onclick = () => window.launcher.minimize();
  document.getElementById('btn-close').onclick = () => window.launcher.close();

  // Main Menu
  document.getElementById('btn-local').onclick = launchSingleplayer;
  document.getElementById('btn-multiplayer').onclick = () => showScreen('mpMenu');
  document.getElementById('btn-settings').onclick = () => {
    document.getElementById('settings-player-name').value = playerName;
    document.getElementById('settings-server').value = apiBase;
    showScreen('settings');
  };
  document.getElementById('btn-exit').onclick = () => window.launcher.close();

  // Multiplayer Menu
  document.getElementById('btn-mp-back').onclick = () => showScreen('menu');
  document.getElementById('btn-host-lan').onclick = () => {
    document.getElementById('host-player-name').value = playerName;
    showScreen('hostLan');
  };
  document.getElementById('btn-join-lan').onclick = () => {
    document.getElementById('join-player-name').value = playerName;
    showScreen('joinLan');
    scanLanGames();
  };
  document.getElementById('btn-online-play').onclick = () => {
    showScreen('online');
    updateOnlineView();
  };

  // Host LAN
  document.getElementById('btn-host-back').onclick = () => showScreen('mpMenu');
  document.getElementById('form-host-game').onsubmit = handleHostLan;
  document.getElementById('host-password-enabled').onchange = (e) => {
    document.querySelector('#screen-host-lan .password-group').style.display =
      e.target.checked ? 'block' : 'none';
  };

  // Join LAN
  document.getElementById('btn-join-back').onclick = () => showScreen('mpMenu');
  document.getElementById('btn-lan-refresh').onclick = scanLanGames;
  document.getElementById('btn-direct-connect').onclick = handleDirectConnect;

  // Online Play
  document.getElementById('btn-online-back').onclick = () => showScreen('mpMenu');
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => switchTab(tab.dataset.tab);
  });
  document.getElementById('form-login').onsubmit = handleLogin;
  document.getElementById('form-register').onsubmit = handleRegister;
  document.getElementById('server-url').value = apiBase;
  document.getElementById('server-url').onchange = (e) => {
    apiBase = e.target.value;
    wsUrl = apiBase.replace('http', 'ws') + '/ws';
    localStorage.setItem('serverUrl', apiBase);
  };
  document.getElementById('btn-logout').onclick = handleLogout;

  // Online Menu (when logged in)
  document.getElementById('btn-browse-games').onclick = () => {
    isLanMode = false;
    showScreen('browser');
    loadGames();
    loadCharacters();
  };
  document.getElementById('btn-create-game').onclick = () => {
    isLanMode = false;
    showScreen('create');
    loadCharacters();
  };
  document.getElementById('btn-quick-join').onclick = handleQuickJoin;
  document.getElementById('btn-characters').onclick = () => {
    showScreen('characters');
    loadCharacters();
    renderCharactersList();
  };

  // Browser Screen
  document.getElementById('btn-browser-back').onclick = () => showScreen('online');
  document.getElementById('btn-refresh').onclick = loadGames;
  document.getElementById('btn-new-char').onclick = handleCreateCharacter;
  document.getElementById('character-select').onchange = (e) => {
    selectedCharacter = characters.find(c => c.id === e.target.value);
  };

  // Create Game Screen
  document.getElementById('btn-create-back').onclick = () => showScreen('online');
  document.getElementById('form-create-game').onsubmit = handleCreateGame;
  document.getElementById('create-visibility').onchange = (e) => {
    document.querySelector('#screen-create .password-group').style.display =
      e.target.value === 'PRIVATE' ? 'block' : 'none';
  };

  // Room Screen
  document.getElementById('btn-leave-room').onclick = handleLeaveGame;
  document.getElementById('btn-ready').onclick = handleToggleReady;
  document.getElementById('btn-start').onclick = handleStartGame;
  document.getElementById('btn-send-chat').onclick = sendChat;
  document.getElementById('chat-input').onkeypress = (e) => {
    if (e.key === 'Enter') sendChat();
  };

  // Characters Screen
  document.getElementById('btn-chars-back').onclick = () => showScreen('online');
  document.getElementById('btn-create-char').onclick = handleCreateCharacter;

  // Settings Screen
  document.getElementById('btn-settings-back').onclick = () => showScreen('menu');
  document.getElementById('btn-save-settings').onclick = saveSettings;

  // In-game
  document.getElementById('btn-end-turn').onclick = () => sendWsMessage('turn:end', {});
  document.getElementById('btn-ingame-menu').onclick = () => showScreen('room');

  // Game events from main process
  window.launcher.onGameEvent(handleGameEvent);
  window.launcher.onGameClosed(handleGameClosed);
}

// Screen management
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name]?.classList.add('active');
}

function showLoading(text = 'LOADING...') {
  loadingText.textContent = text;
  loadingOverlay.classList.add('active');
}

function hideLoading() {
  loadingOverlay.classList.remove('active');
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`form-${tab}`).classList.add('active');
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 5000);
}

// Settings
function loadSettings() {
  apiBase = localStorage.getItem('serverUrl') || 'http://localhost:3001';
  wsUrl = apiBase.replace('http', 'ws') + '/ws';
  playerName = localStorage.getItem('playerName') || 'Vault Dweller';
}

function saveSettings() {
  playerName = document.getElementById('settings-player-name').value || 'Vault Dweller';
  apiBase = document.getElementById('settings-server').value;
  wsUrl = apiBase.replace('http', 'ws') + '/ws';

  localStorage.setItem('playerName', playerName);
  localStorage.setItem('serverUrl', apiBase);

  showScreen('menu');
}

// Singleplayer
async function launchSingleplayer() {
  showLoading('LAUNCHING FALLOUT...');
  try {
    await window.launcher.launchGame({ singleplayer: true });
    hideLoading();
    window.launcher.minimize();
  } catch (err) {
    hideLoading();
    alert('Failed to launch game: ' + err.message);
  }
}

// LAN Hosting
async function handleHostLan(e) {
  e.preventDefault();

  playerName = document.getElementById('host-player-name').value;
  localStorage.setItem('playerName', playerName);

  const gameName = document.getElementById('host-game-name').value;
  const maxPlayers = parseInt(document.getElementById('host-max-players').value);
  const port = parseInt(document.getElementById('host-port').value);
  const usePassword = document.getElementById('host-password-enabled').checked;
  const password = usePassword ? document.getElementById('host-password').value : null;

  showLoading('STARTING HOST...');

  try {
    await window.launcher.launchGame({
      singleplayer: false,
      host: true,
      gameName,
      playerName,
      maxPlayers,
      port,
      password
    });

    hideLoading();
    isLanMode = true;

    // Set up room UI for hosting
    currentGame = {
      name: gameName,
      maxPlayers,
      participants: [{ username: playerName, isHost: true, isReady: true }],
      hostId: 'local',
      status: 'LOBBY'
    };
    updateRoomUI();
    showScreen('room');
  } catch (err) {
    hideLoading();
    alert('Failed to start hosting: ' + err.message);
  }
}

// LAN Joining
function scanLanGames() {
  const list = document.getElementById('lan-games-list');
  list.innerHTML = '<div class="no-games">Searching for LAN games...</div>';

  // TODO: Implement actual LAN discovery via UDP broadcast
  // For now, show empty after a delay
  setTimeout(() => {
    list.innerHTML = '<div class="no-games">No LAN games found.<br>Use Direct Connect below.</div>';
  }, 2000);
}

async function handleDirectConnect() {
  const name = document.getElementById('join-player-name').value;
  if (!name) {
    alert('Please enter your name');
    return;
  }

  playerName = name;
  localStorage.setItem('playerName', playerName);

  const ip = document.getElementById('join-ip').value;
  const port = document.getElementById('join-port').value;

  if (!ip) {
    alert('Please enter an IP address');
    return;
  }

  showLoading('CONNECTING...');

  try {
    await window.launcher.launchGame({
      singleplayer: false,
      host: false,
      playerName,
      serverIp: ip,
      serverPort: parseInt(port)
    });

    hideLoading();
    isLanMode = true;

    // Will receive game info from server
    currentGame = {
      name: 'Connecting...',
      maxPlayers: 4,
      participants: [],
      status: 'LOBBY'
    };
    updateRoomUI();
    showScreen('room');
  } catch (err) {
    hideLoading();
    alert('Failed to connect: ' + err.message);
  }
}

// Online Auth
function loadStoredAuth() {
  accessToken = localStorage.getItem('accessToken');
  refreshToken = localStorage.getItem('refreshToken');
  const userJson = localStorage.getItem('user');
  if (userJson) {
    try { user = JSON.parse(userJson); } catch {}
  }
}

function updateOnlineView() {
  const authView = document.getElementById('online-auth');
  const menuView = document.getElementById('online-menu');
  const userBadge = document.getElementById('online-user-name');

  if (accessToken && user) {
    authView.style.display = 'none';
    menuView.style.display = 'flex';
    userBadge.textContent = user.username;
    userBadge.style.display = 'block';
    connectWebSocket();
  } else {
    authView.style.display = 'flex';
    menuView.style.display = 'none';
    userBadge.style.display = 'none';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  showLoading('AUTHENTICATING...');
  try {
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Login failed');
    }

    const data = await res.json();
    setAuthData(data);
    hideLoading();
    updateOnlineView();
  } catch (err) {
    hideLoading();
    showError('auth-error', err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;

  showLoading('CREATING ACCOUNT...');
  try {
    const res = await fetch(`${apiBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Registration failed');
    }

    const data = await res.json();
    setAuthData(data);
    hideLoading();
    updateOnlineView();
  } catch (err) {
    hideLoading();
    showError('auth-error', err.message);
  }
}

function handleLogout() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  accessToken = null;
  user = null;
  if (ws) ws.close();
  updateOnlineView();
}

function setAuthData(data) {
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
  user = data.user;
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
  localStorage.setItem('user', JSON.stringify(user));
}

async function fetchWithAuth(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(url, { ...options, headers });
}

// WebSocket
function connectWebSocket() {
  if (ws) ws.close();

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    sendWsMessage('auth:login', { token: accessToken });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('Failed to parse WS message:', e);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    if (accessToken && !isLanMode) {
      setTimeout(connectWebSocket, 3000);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function sendWsMessage(type, payload = {}) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function handleWsMessage(msg) {
  console.log('WS:', msg.type, msg);

  switch (msg.type) {
    case 'auth:success':
      console.log('WS authenticated');
      break;

    case 'session:joined':
      currentGame = msg.session;
      updateRoomUI();
      showScreen('room');
      break;

    case 'player:joined':
    case 'player:left':
    case 'player:ready-changed':
      if (currentGame) {
        loadGameDetails(currentGame.id);
      }
      break;

    case 'session:starting':
      showLoading('STARTING GAME...');
      break;

    case 'session:started':
      hideLoading();
      launchMultiplayer();
      break;

    case 'chat:message':
      addChatMessage(msg.senderName, msg.message, msg.isSystem);
      break;

    case 'turn:start':
      updateTurnUI(msg);
      break;

    case 'combat:result':
      addChatMessage('COMBAT', formatCombatResult(msg), true);
      break;
  }
}

// Games
async function loadGames() {
  try {
    const res = await fetch(`${apiBase}/api/games`);
    const games = await res.json();
    renderGamesList(games);
  } catch (err) {
    console.error('Failed to load games:', err);
    document.getElementById('games-list').innerHTML =
      '<div class="no-games">Failed to load games</div>';
  }
}

function renderGamesList(games) {
  const list = document.getElementById('games-list');

  if (!games || games.length === 0) {
    list.innerHTML = '<div class="no-games">No games available.<br>Create one or wait for others.</div>';
    return;
  }

  list.innerHTML = games.map(game => `
    <div class="game-item" onclick="joinGame('${game.id}')">
      <div class="game-item-header">
        <span class="game-item-name">${escapeHtml(game.name)}</span>
        <span class="game-item-players">${game._count?.participants || game.participants?.length || 0}/${game.maxPlayers}</span>
      </div>
      <div class="game-item-info">
        Host: ${escapeHtml(game.host?.username || 'Unknown')} | Level ${game.minLevel}-${game.maxLevel} | ${game.status}
      </div>
    </div>
  `).join('');
}

async function handleCreateGame(e) {
  e.preventDefault();

  const options = {
    name: document.getElementById('create-name').value,
    maxPlayers: parseInt(document.getElementById('create-max-players').value),
    turnTimeBase: parseInt(document.getElementById('create-turn-time').value),
    minLevel: parseInt(document.getElementById('create-min-level').value),
    maxLevel: parseInt(document.getElementById('create-max-level').value),
    visibility: document.getElementById('create-visibility').value,
    characterId: selectedCharacter?.id
  };

  if (options.visibility === 'PRIVATE') {
    options.password = document.getElementById('create-password').value;
  }

  showLoading('CREATING GAME...');
  try {
    const res = await fetchWithAuth(`${apiBase}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });

    if (!res.ok) throw new Error('Failed to create game');

    const game = await res.json();
    hideLoading();
    sendWsMessage('session:join', { gameId: game.id });
  } catch (err) {
    hideLoading();
    alert(err.message);
  }
}

window.joinGame = async function(gameId) {
  showLoading('JOINING GAME...');
  try {
    const res = await fetchWithAuth(`${apiBase}/api/games/${gameId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: selectedCharacter?.id })
    });

    if (!res.ok) throw new Error('Failed to join game');

    hideLoading();
    sendWsMessage('session:join', { gameId });
  } catch (err) {
    hideLoading();
    alert(err.message);
  }
};

async function handleQuickJoin() {
  showLoading('FINDING GAME...');
  try {
    const res = await fetch(`${apiBase}/api/games`);
    const games = await res.json();

    const available = games.filter(g =>
      g.status === 'LOBBY' &&
      (g._count?.participants || g.participants?.length || 0) < g.maxPlayers
    );

    if (available.length === 0) {
      hideLoading();
      alert('No games available. Create one!');
      return;
    }

    hideLoading();
    window.joinGame(available[0].id);
  } catch (err) {
    hideLoading();
    alert('Failed to find games');
  }
}

async function loadGameDetails(gameId) {
  try {
    const res = await fetch(`${apiBase}/api/games/${gameId}`);
    currentGame = await res.json();
    updateRoomUI();
  } catch (err) {
    console.error('Failed to load game details:', err);
  }
}

function updateRoomUI() {
  if (!currentGame) return;

  document.getElementById('room-name').textContent = currentGame.name;
  document.getElementById('room-status').textContent = currentGame.status;
  document.getElementById('room-players').textContent =
    `${currentGame.participants?.length || 0}/${currentGame.maxPlayers}`;

  const isHost = isLanMode
    ? currentGame.hostId === 'local'
    : currentGame.hostId === user?.id;

  const allReady = currentGame.participants?.every(p => p.isReady || p.isHost);

  document.getElementById('btn-start').style.display = isHost ? 'block' : 'none';
  document.getElementById('btn-start').disabled = !allReady || (currentGame.participants?.length || 0) < 2;

  const playersList = document.getElementById('players-list');
  playersList.innerHTML = (currentGame.participants || []).map(p => `
    <li class="player-item ${p.isReady ? 'ready' : ''} ${p.isHost ? 'host' : ''}">
      <span class="player-name">${escapeHtml(p.character?.name || p.username || 'Unknown')}</span>
      ${p.isHost ? '<span class="player-badge" style="background:#9f9f4a">HOST</span>' : ''}
      ${p.isReady ? '<span class="player-badge">READY</span>' : ''}
    </li>
  `).join('');
}

function handleToggleReady() {
  if (isLanMode) {
    // TODO: Send ready to game process
  } else {
    sendWsMessage('session:ready', {});
  }
}

async function handleStartGame() {
  showLoading('STARTING GAME...');
  if (isLanMode) {
    // TODO: Send start to game process
    hideLoading();
  } else {
    try {
      await fetchWithAuth(`${apiBase}/api/games/${currentGame.id}/start`, { method: 'POST' });
    } catch (err) {
      hideLoading();
      alert('Failed to start game');
    }
  }
}

async function handleLeaveGame() {
  if (isLanMode) {
    // TODO: Send leave to game process
    currentGame = null;
    showScreen('mpMenu');
  } else {
    try {
      if (currentGame) {
        await fetchWithAuth(`${apiBase}/api/games/${currentGame.id}/leave`, { method: 'POST' });
        sendWsMessage('session:leave', {});
      }
      currentGame = null;
      showScreen('online');
    } catch (err) {
      console.error('Failed to leave game:', err);
      showScreen('online');
    }
  }
}

// Characters
async function loadCharacters() {
  try {
    const res = await fetchWithAuth(`${apiBase}/api/users/me/characters`);
    if (res.ok) {
      characters = await res.json();
      renderCharacterSelect();
    }
  } catch (err) {
    console.error('Failed to load characters:', err);
  }
}

function renderCharacterSelect() {
  const select = document.getElementById('character-select');
  if (!characters || characters.length === 0) {
    select.innerHTML = '<option value="">No characters</option>';
    selectedCharacter = null;
  } else {
    select.innerHTML = characters.map(c =>
      `<option value="${c.id}">${escapeHtml(c.name)} (Lv ${c.level})</option>`
    ).join('');
    selectedCharacter = characters[0];
  }
}

function renderCharactersList() {
  const list = document.getElementById('characters-list');
  if (!characters || characters.length === 0) {
    list.innerHTML = '<div class="no-games">No characters yet.<br>Create your first character!</div>';
    return;
  }

  list.innerHTML = characters.map(c => `
    <div class="character-item">
      <span class="character-name">${escapeHtml(c.name)}</span>
      <span class="character-level">Level ${c.level}</span>
    </div>
  `).join('');
}

async function handleCreateCharacter() {
  const name = prompt('Enter character name:');
  if (!name) return;

  try {
    const res = await fetchWithAuth(`${apiBase}/api/users/me/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    if (!res.ok) throw new Error('Failed to create character');

    const char = await res.json();
    characters.push(char);
    renderCharacterSelect();
    renderCharactersList();
    selectedCharacter = char;
  } catch (err) {
    alert(err.message);
  }
}

// Chat
function sendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  if (isLanMode) {
    // TODO: Send chat to game process
    addChatMessage(playerName, message, false);
  } else {
    sendWsMessage('chat:message', { message });
  }
  input.value = '';
}

function addChatMessage(sender, message, isSystem = false) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${isSystem ? 'system' : ''}`;
  div.innerHTML = `<span class="chat-sender">${escapeHtml(sender)}:</span> <span class="chat-text">${escapeHtml(message)}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Game launch
async function launchMultiplayer() {
  const myParticipant = currentGame?.participants?.find(p => p.userId === user?.id);

  showLoading('LAUNCHING FALLOUT...');

  try {
    await window.launcher.launchGame({
      singleplayer: false,
      sessionId: currentGame.id,
      participantId: myParticipant?.id
    });

    hideLoading();
    showScreen('ingame');
  } catch (err) {
    hideLoading();
    alert('Failed to launch game: ' + err.message);
    showScreen('room');
  }
}

function handleGameEvent(event) {
  console.log('Game event:', event);
  if (event.type === 'action') {
    sendWsMessage('action:' + event.action, event.data);
  }
}

function handleGameClosed(data) {
  console.log('Game closed:', data);
  if (currentGame) {
    showScreen('room');
  } else {
    showScreen('menu');
  }
}

function updateTurnUI(turnData) {
  const isMyTurn = turnData.participantId ===
    currentGame?.participants?.find(p => p.userId === user?.id)?.id;
  document.getElementById('ingame-turn').textContent =
    isMyTurn ? 'YOUR TURN' : `${turnData.playerName || 'Unknown'}'s turn`;
  document.getElementById('ingame-timer').textContent = (turnData.timeLimit || 30) + 's';
}

function formatCombatResult(data) {
  let msg = `${data.attackerName} ${data.hit ? 'hit' : 'missed'} ${data.targetName}`;
  if (data.hit) msg += ` for ${data.damage} damage`;
  if (data.isCritical) msg += ' (CRITICAL!)';
  if (data.targetDied) msg += ' - KILL!';
  return msg;
}

// Utilities
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
