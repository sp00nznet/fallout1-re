// State
let apiBase = 'http://localhost:3001';
let wsUrl = 'ws://localhost:3001/ws';
let accessToken = null;
let refreshToken = null;
let user = null;
let ws = null;
let currentGame = null;
let characters = [];
let selectedCharacter = null;

// Elements
const screens = {
  login: document.getElementById('screen-login'),
  lobby: document.getElementById('screen-lobby'),
  room: document.getElementById('screen-room'),
  ingame: document.getElementById('screen-ingame')
};

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadStoredAuth();
});

function setupEventListeners() {
  // Titlebar
  document.getElementById('btn-minimize').onclick = () => window.launcher.minimize();
  document.getElementById('btn-close').onclick = () => window.launcher.close();

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => switchTab(tab.dataset.tab);
  });

  // Auth forms
  document.getElementById('form-login').onsubmit = handleLogin;
  document.getElementById('form-register').onsubmit = handleRegister;
  document.getElementById('btn-logout').onclick = handleLogout;

  // Server config
  document.getElementById('server-url').onchange = (e) => {
    apiBase = e.target.value;
    wsUrl = e.target.value.replace('http', 'ws') + '/ws';
  };

  // Lobby
  document.getElementById('btn-refresh').onclick = loadGames;
  document.getElementById('btn-create-game').onclick = () => toggleModal('modal-create', true);
  document.getElementById('btn-cancel-create').onclick = () => toggleModal('modal-create', false);
  document.getElementById('form-create-game').onsubmit = handleCreateGame;
  document.getElementById('btn-new-char').onclick = handleCreateCharacter;
  document.getElementById('character-select').onchange = (e) => {
    selectedCharacter = characters.find(c => c.id === e.target.value);
  };

  // Room
  document.getElementById('btn-ready').onclick = handleToggleReady;
  document.getElementById('btn-start').onclick = handleStartGame;
  document.getElementById('btn-leave').onclick = handleLeaveGame;
  document.getElementById('btn-send-chat').onclick = sendChat;
  document.getElementById('chat-input').onkeypress = (e) => {
    if (e.key === 'Enter') sendChat();
  };

  // In-game
  document.getElementById('btn-end-turn').onclick = () => sendWsMessage('turn:end', {});
  document.getElementById('btn-menu').onclick = () => showScreen('room');

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

function toggleModal(id, show) {
  document.getElementById(id).classList.toggle('active', show);
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 5000);
}

// Auth
function loadStoredAuth() {
  accessToken = localStorage.getItem('accessToken');
  refreshToken = localStorage.getItem('refreshToken');
  const userJson = localStorage.getItem('user');
  if (userJson) {
    try { user = JSON.parse(userJson); } catch {}
  }

  if (accessToken && user) {
    showScreen('lobby');
    document.getElementById('user-name').textContent = user.username;
    loadCharacters();
    loadGames();
    connectWebSocket();
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
    showScreen('lobby');
    document.getElementById('user-name').textContent = user.username;
    loadCharacters();
    loadGames();
    connectWebSocket();
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
    showScreen('lobby');
    document.getElementById('user-name').textContent = user.username;
    loadCharacters();
    loadGames();
    connectWebSocket();
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
  showScreen('login');
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
    setTimeout(connectWebSocket, 3000);
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
      launchGame();
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
  }
}

function renderGamesList(games) {
  const list = document.getElementById('games-list');

  if (games.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No games available</div>';
    return;
  }

  list.innerHTML = games.map(game => `
    <div class="game-item" onclick="joinGame('${game.id}')">
      <div class="game-item-header">
        <span class="game-item-name">${escapeHtml(game.name)}</span>
        <span class="game-item-players">${game._count?.participants || game.participants?.length || 0}/${game.maxPlayers}</span>
      </div>
      <div class="game-item-info">
        Host: ${escapeHtml(game.host.username)} | Level ${game.minLevel}-${game.maxLevel} | ${game.status}
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
    characterId: selectedCharacter?.id
  };

  showLoading('CREATING GAME...');
  try {
    const res = await fetchWithAuth(`${apiBase}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });

    if (!res.ok) throw new Error('Failed to create game');

    const game = await res.json();
    toggleModal('modal-create', false);
    hideLoading();

    // Join via WebSocket
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
  document.getElementById('room-players').textContent = `${currentGame.participants.length}/${currentGame.maxPlayers}`;

  const isHost = currentGame.hostId === user?.id;
  const allReady = currentGame.participants.every(p => p.isReady || p.isHost);

  document.getElementById('btn-start').style.display = isHost ? 'block' : 'none';
  document.getElementById('btn-start').disabled = !allReady || currentGame.participants.length < 2;

  const playersList = document.getElementById('players-list');
  playersList.innerHTML = currentGame.participants.map(p => `
    <li class="player-item ${p.isReady ? 'ready' : ''} ${p.isHost ? 'host' : ''}">
      <span class="player-name">${escapeHtml(p.character?.name || p.username || 'Unknown')}</span>
      ${p.isHost ? '<span class="player-badge">HOST</span>' : ''}
      ${p.isReady ? '<span class="player-badge" style="background:#4a9f4a">READY</span>' : ''}
    </li>
  `).join('');
}

function handleToggleReady() {
  sendWsMessage('session:ready', {});
}

async function handleStartGame() {
  showLoading('STARTING GAME...');
  try {
    await fetchWithAuth(`${apiBase}/api/games/${currentGame.id}/start`, { method: 'POST' });
  } catch (err) {
    hideLoading();
    alert('Failed to start game');
  }
}

async function handleLeaveGame() {
  try {
    await fetchWithAuth(`${apiBase}/api/games/${currentGame.id}/leave`, { method: 'POST' });
    sendWsMessage('session:leave', {});
    currentGame = null;
    showScreen('lobby');
    loadGames();
  } catch (err) {
    console.error('Failed to leave game:', err);
  }
}

// Characters
async function loadCharacters() {
  try {
    const res = await fetchWithAuth(`${apiBase}/api/users/me/characters`);
    characters = await res.json();
    renderCharacterSelect();
  } catch (err) {
    console.error('Failed to load characters:', err);
  }
}

function renderCharacterSelect() {
  const select = document.getElementById('character-select');
  if (characters.length === 0) {
    select.innerHTML = '<option value="">No characters - create one</option>';
    selectedCharacter = null;
  } else {
    select.innerHTML = characters.map(c =>
      `<option value="${c.id}">${escapeHtml(c.name)} (Lv ${c.level})</option>`
    ).join('');
    selectedCharacter = characters[0];
  }
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
    selectedCharacter = char;
    document.getElementById('character-select').value = char.id;
  } catch (err) {
    alert(err.message);
  }
}

// Chat
function sendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  sendWsMessage('chat:message', { message });
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
async function launchGame() {
  const myParticipant = currentGame.participants.find(p => p.userId === user.id);

  showLoading('LAUNCHING FALLOUT...');

  try {
    await window.launcher.launchGame({
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
  // Forward to server or update UI
  if (event.type === 'action') {
    sendWsMessage('action:' + event.action, event.data);
  }
}

function handleGameClosed(data) {
  console.log('Game closed:', data);
  showScreen('room');
}

function updateTurnUI(turnData) {
  const isMyTurn = turnData.participantId === currentGame?.participants?.find(p => p.userId === user.id)?.id;
  document.getElementById('ingame-turn').textContent = isMyTurn ? 'YOUR TURN' : `${turnData.playerName}'s turn`;
  document.getElementById('ingame-timer').textContent = turnData.timeLimit + 's';
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
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
