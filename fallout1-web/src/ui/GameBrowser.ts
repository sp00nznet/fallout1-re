/**
 * Game browser for finding and joining multiplayer games
 */

import { gameService, GameSession, Character, CreateGameOptions } from '../services/GameService.js';
import { authService } from '../services/AuthService.js';

interface GameBrowserOptions {
  onJoinGame: (gameId: string) => void;
  onBack: () => void;
}

export class GameBrowser {
  private container: HTMLDivElement;
  private games: GameSession[] = [];
  private characters: Character[] = [];
  private selectedCharacter: Character | null | undefined = null;
  private onJoinGame: (gameId: string) => void;
  private onBack: () => void;
  private refreshInterval: number | null = null;
  private showCreateModal = false;

  constructor(options: GameBrowserOptions) {
    this.onJoinGame = options.onJoinGame;
    this.onBack = options.onBack;
    this.container = document.createElement('div');
    this.container.className = 'game-browser';
  }

  async mount(parent: HTMLElement): Promise<void> {
    parent.appendChild(this.container);
    this.addStyles();
    await this.loadCharacters();
    await this.refresh();

    // Auto-refresh every 5 seconds
    this.refreshInterval = window.setInterval(() => this.refresh(), 5000);
  }

  unmount(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.container.remove();
  }

  private async loadCharacters(): Promise<void> {
    try {
      this.characters = await gameService.getCharacters();
      if (this.characters.length > 0) {
        this.selectedCharacter = this.characters[0];
      }
    } catch (error) {
      console.error('Failed to load characters:', error);
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.games = await gameService.listGames();
      this.render();
    } catch (error) {
      console.error('Failed to refresh games:', error);
    }
  }

  private render(): void {
    const user = authService.getUser();

    this.container.innerHTML = `
      <div class="browser-overlay">
        <div class="browser-modal">
          <div class="browser-header">
            <h2>Game Browser</h2>
            <div class="browser-actions">
              <button class="create-game-btn" id="create-game-btn">Create Game</button>
              <button class="back-btn" id="back-btn">Back</button>
            </div>
          </div>

          <div class="character-select">
            <label>Your Character:</label>
            <select id="character-select">
              ${this.characters.length === 0 ?
                '<option value="">No characters - create one first</option>' :
                this.characters.map(c => `
                  <option value="${c.id}" ${this.selectedCharacter?.id === c.id ? 'selected' : ''}>
                    ${c.name} (Level ${c.level})
                  </option>
                `).join('')
              }
            </select>
            <button class="create-char-btn" id="create-char-btn">+ New Character</button>
          </div>

          <div class="games-list">
            ${this.games.length === 0 ? `
              <div class="no-games">
                <p>No games available</p>
                <p class="hint">Create a new game or wait for others to host</p>
              </div>
            ` : `
              <table class="games-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Host</th>
                    <th>Players</th>
                    <th>Level</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${this.games.map(game => this.renderGameRow(game)).join('')}
                </tbody>
              </table>
            `}
          </div>

          <div class="browser-footer">
            <span class="user-info">Logged in as: ${user?.username || 'Unknown'}</span>
            <button class="refresh-btn" id="refresh-btn">Refresh</button>
          </div>
        </div>

        ${this.showCreateModal ? this.renderCreateModal() : ''}
      </div>
    `;

    this.attachEventListeners();
  }

  private renderGameRow(game: GameSession): string {
    const playerCount = game._count?.participants || game.participants.length;
    const canJoin = game.status === 'LOBBY' && playerCount < game.maxPlayers;

    return `
      <tr class="game-row" data-game-id="${game.id}">
        <td class="game-name">
          ${game.name}
          ${game.visibility === 'PRIVATE' ? '<span class="private-badge">Private</span>' : ''}
        </td>
        <td class="game-host">${game.host.username}</td>
        <td class="game-players">${playerCount}/${game.maxPlayers}</td>
        <td class="game-level">${game.minLevel}-${game.maxLevel}</td>
        <td class="game-status">
          <span class="status-badge status-${game.status.toLowerCase()}">${game.status}</span>
        </td>
        <td class="game-actions">
          ${canJoin ? `
            <button class="join-btn" data-game-id="${game.id}">Join</button>
          ` : game.status === 'PLAYING' ? `
            <button class="spectate-btn" data-game-id="${game.id}" disabled>Spectate</button>
          ` : ''}
        </td>
      </tr>
    `;
  }

  private renderCreateModal(): string {
    return `
      <div class="create-modal-overlay" id="create-modal">
        <div class="create-modal">
          <div class="create-header">
            <h3>Create New Game</h3>
            <button class="close-btn" id="close-create-btn">&times;</button>
          </div>

          <form id="create-game-form">
            <div class="form-group">
              <label for="game-name">Game Name</label>
              <input type="text" id="game-name" name="name" required
                     maxlength="50" placeholder="My Wasteland Game">
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="max-players">Max Players</label>
                <select id="max-players" name="maxPlayers">
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4" selected>4</option>
                  <option value="6">6</option>
                  <option value="8">8</option>
                </select>
              </div>

              <div class="form-group">
                <label for="turn-time">Turn Time (sec)</label>
                <select id="turn-time" name="turnTimeBase">
                  <option value="15">15</option>
                  <option value="30" selected>30</option>
                  <option value="45">45</option>
                  <option value="60">60</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="min-level">Min Level</label>
                <input type="number" id="min-level" name="minLevel"
                       min="1" max="99" value="1">
              </div>

              <div class="form-group">
                <label for="max-level">Max Level</label>
                <input type="number" id="max-level" name="maxLevel"
                       min="1" max="99" value="99">
              </div>
            </div>

            <div class="form-group">
              <label for="visibility">Visibility</label>
              <select id="visibility" name="visibility">
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private (Password Required)</option>
              </select>
            </div>

            <div class="form-group password-group" style="display: none;">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" placeholder="Enter password">
            </div>

            <div class="form-actions">
              <button type="button" class="cancel-btn" id="cancel-create-btn">Cancel</button>
              <button type="submit" class="submit-btn">Create Game</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  private attachEventListeners(): void {
    const createBtn = this.container.querySelector('#create-game-btn');
    const backBtn = this.container.querySelector('#back-btn');
    const refreshBtn = this.container.querySelector('#refresh-btn');
    const charSelect = this.container.querySelector('#character-select') as HTMLSelectElement;
    const createCharBtn = this.container.querySelector('#create-char-btn');

    createBtn?.addEventListener('click', () => this.openCreateModal());
    backBtn?.addEventListener('click', () => {
      this.unmount();
      this.onBack();
    });
    refreshBtn?.addEventListener('click', () => this.refresh());

    charSelect?.addEventListener('change', (e) => {
      const charId = (e.target as HTMLSelectElement).value;
      this.selectedCharacter = this.characters.find(c => c.id === charId) || null;
    });

    createCharBtn?.addEventListener('click', () => this.handleCreateCharacter());

    // Join buttons
    const joinBtns = this.container.querySelectorAll('.join-btn');
    joinBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const gameId = (e.target as HTMLElement).dataset.gameId;
        if (gameId) this.handleJoinGame(gameId);
      });
    });

    // Create modal events
    if (this.showCreateModal) {
      const closeBtn = this.container.querySelector('#close-create-btn');
      const cancelBtn = this.container.querySelector('#cancel-create-btn');
      const form = this.container.querySelector('#create-game-form') as HTMLFormElement;
      const visSelect = this.container.querySelector('#visibility') as HTMLSelectElement;

      closeBtn?.addEventListener('click', () => this.closeCreateModal());
      cancelBtn?.addEventListener('click', () => this.closeCreateModal());

      visSelect?.addEventListener('change', (e) => {
        const pwGroup = this.container.querySelector('.password-group') as HTMLElement;
        if (pwGroup) {
          pwGroup.style.display = (e.target as HTMLSelectElement).value === 'PRIVATE' ? 'block' : 'none';
        }
      });

      form?.addEventListener('submit', (e) => this.handleCreateGame(e));

      // Close on overlay click
      const overlay = this.container.querySelector('#create-modal');
      overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeCreateModal();
      });
    }
  }

  private openCreateModal(): void {
    this.showCreateModal = true;
    this.render();
  }

  private closeCreateModal(): void {
    this.showCreateModal = false;
    this.render();
  }

  private async handleCreateGame(e: Event): Promise<void> {
    e.preventDefault();

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);

    const options: CreateGameOptions = {
      name: formData.get('name') as string,
      maxPlayers: parseInt(formData.get('maxPlayers') as string, 10),
      turnTimeBase: parseInt(formData.get('turnTimeBase') as string, 10),
      minLevel: parseInt(formData.get('minLevel') as string, 10),
      maxLevel: parseInt(formData.get('maxLevel') as string, 10),
      visibility: formData.get('visibility') as 'PUBLIC' | 'PRIVATE',
      characterId: this.selectedCharacter?.id
    };

    if (options.visibility === 'PRIVATE') {
      options.password = formData.get('password') as string;
    }

    try {
      const game = await gameService.createGame(options);
      this.closeCreateModal();
      this.unmount();
      this.onJoinGame(game.id);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create game');
    }
  }

  private async handleJoinGame(gameId: string): Promise<void> {
    const game = this.games.find(g => g.id === gameId);
    if (!game) return;

    let password: string | undefined;
    if (game.visibility === 'PRIVATE') {
      password = prompt('Enter game password:') || undefined;
      if (!password) return;
    }

    try {
      await gameService.joinGame(gameId, password, this.selectedCharacter?.id);
      this.unmount();
      this.onJoinGame(gameId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to join game');
    }
  }

  private async handleCreateCharacter(): Promise<void> {
    const name = prompt('Enter character name:');
    if (!name) return;

    try {
      const character = await gameService.createCharacter({ name });
      this.characters.push(character);
      this.selectedCharacter = character;
      this.render();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create character');
    }
  }

  private addStyles(): void {
    if (document.getElementById('game-browser-styles')) return;

    const style = document.createElement('style');
    style.id = 'game-browser-styles';
    style.textContent = `
      .game-browser {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1000;
      }

      .browser-overlay {
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .browser-modal {
        background: #1a1a2e;
        border: 2px solid #4a9f4a;
        border-radius: 8px;
        padding: 24px;
        width: 100%;
        max-width: 800px;
        max-height: 90vh;
        overflow-y: auto;
        color: #e0e0e0;
        font-family: 'Courier New', monospace;
      }

      .browser-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .browser-header h2 {
        margin: 0;
        color: #4a9f4a;
      }

      .browser-actions {
        display: flex;
        gap: 8px;
      }

      .browser-actions button {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
      }

      .create-game-btn {
        background: #4a9f4a;
        color: #000;
        font-weight: bold;
      }

      .back-btn {
        background: #333;
        color: #fff;
      }

      .character-select {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
        padding: 12px;
        background: #0d0d1a;
        border-radius: 4px;
      }

      .character-select label {
        color: #888;
      }

      .character-select select {
        flex: 1;
        padding: 8px;
        background: #1a1a2e;
        border: 1px solid #333;
        border-radius: 4px;
        color: #fff;
        font-family: inherit;
      }

      .create-char-btn {
        padding: 8px 12px;
        background: #333;
        border: none;
        border-radius: 4px;
        color: #4a9f4a;
        cursor: pointer;
        font-family: inherit;
      }

      .games-list {
        margin-bottom: 20px;
      }

      .no-games {
        text-align: center;
        padding: 40px;
        color: #888;
      }

      .no-games .hint {
        font-size: 14px;
        color: #666;
      }

      .games-table {
        width: 100%;
        border-collapse: collapse;
      }

      .games-table th {
        text-align: left;
        padding: 10px;
        border-bottom: 1px solid #333;
        color: #888;
        font-size: 14px;
      }

      .games-table td {
        padding: 10px;
        border-bottom: 1px solid #222;
      }

      .game-row:hover {
        background: #0d0d1a;
      }

      .private-badge {
        font-size: 10px;
        padding: 2px 6px;
        background: #4a4a1a;
        color: #9f9f4a;
        border-radius: 3px;
        margin-left: 8px;
      }

      .status-badge {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 3px;
      }

      .status-lobby {
        background: #1a4a1a;
        color: #4a9f4a;
      }

      .status-playing {
        background: #4a3a1a;
        color: #9f7a4a;
      }

      .join-btn {
        padding: 6px 12px;
        background: #4a9f4a;
        border: none;
        border-radius: 4px;
        color: #000;
        cursor: pointer;
        font-family: inherit;
      }

      .spectate-btn {
        padding: 6px 12px;
        background: #333;
        border: none;
        border-radius: 4px;
        color: #888;
      }

      .browser-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: #888;
        font-size: 14px;
      }

      .refresh-btn {
        padding: 6px 12px;
        background: #333;
        border: none;
        border-radius: 4px;
        color: #fff;
        cursor: pointer;
        font-family: inherit;
      }

      /* Create Modal */
      .create-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1100;
      }

      .create-modal {
        background: #1a1a2e;
        border: 2px solid #4a9f4a;
        border-radius: 8px;
        padding: 24px;
        width: 100%;
        max-width: 400px;
      }

      .create-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .create-header h3 {
        margin: 0;
        color: #4a9f4a;
      }

      .create-modal .close-btn {
        background: none;
        border: none;
        color: #888;
        font-size: 24px;
        cursor: pointer;
      }

      .create-modal .form-group {
        margin-bottom: 16px;
      }

      .create-modal label {
        display: block;
        margin-bottom: 4px;
        color: #aaa;
        font-size: 14px;
      }

      .create-modal input,
      .create-modal select {
        width: 100%;
        padding: 8px;
        background: #0d0d1a;
        border: 1px solid #333;
        border-radius: 4px;
        color: #fff;
        font-family: inherit;
        box-sizing: border-box;
      }

      .form-row {
        display: flex;
        gap: 16px;
      }

      .form-row .form-group {
        flex: 1;
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 20px;
      }

      .form-actions button {
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
      }

      .form-actions .cancel-btn {
        background: #333;
        color: #fff;
      }

      .form-actions .submit-btn {
        background: #4a9f4a;
        color: #000;
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);
  }
}
