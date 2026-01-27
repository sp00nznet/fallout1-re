/**
 * Login/Register screen for the multiplayer platform
 */

import { authService } from '../services/AuthService.js';

type AuthMode = 'login' | 'register';
type OnSuccessCallback = () => void;

interface LoginScreenOptions {
  onSuccess: OnSuccessCallback;
  onCancel?: () => void;
}

export class LoginScreen {
  private container: HTMLDivElement;
  private mode: AuthMode = 'login';
  private onSuccess: OnSuccessCallback;
  private onCancel?: () => void;
  private isLoading = false;

  constructor(options: LoginScreenOptions) {
    this.onSuccess = options.onSuccess;
    this.onCancel = options.onCancel;
    this.container = document.createElement('div');
    this.container.className = 'login-screen';
    this.render();
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
    this.addStyles();
  }

  unmount(): void {
    this.container.remove();
  }

  private render(): void {
    const isLogin = this.mode === 'login';

    this.container.innerHTML = `
      <div class="login-overlay">
        <div class="login-modal">
          <div class="login-header">
            <h2>${isLogin ? 'Login' : 'Register'}</h2>
            ${this.onCancel ? '<button class="close-btn">&times;</button>' : ''}
          </div>

          <form class="login-form">
            ${!isLogin ? `
              <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username"
                       pattern="[a-zA-Z0-9_]{3,20}"
                       title="3-20 characters, letters, numbers, underscore only"
                       required>
              </div>
            ` : ''}

            <div class="form-group">
              <label for="email">Email</label>
              <input type="email" id="email" name="email" required>
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password"
                     minlength="8" required>
            </div>

            ${!isLogin ? `
              <div class="form-group">
                <label for="confirmPassword">Confirm Password</label>
                <input type="password" id="confirmPassword" name="confirmPassword"
                       minlength="8" required>
              </div>
            ` : ''}

            <div class="error-message" style="display: none;"></div>

            <button type="submit" class="submit-btn" ${this.isLoading ? 'disabled' : ''}>
              ${this.isLoading ? 'Loading...' : (isLogin ? 'Login' : 'Register')}
            </button>
          </form>

          <div class="login-footer">
            <p>
              ${isLogin ? "Don't have an account?" : 'Already have an account?'}
              <button class="switch-mode-btn">
                ${isLogin ? 'Register' : 'Login'}
              </button>
            </p>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const form = this.container.querySelector('.login-form') as HTMLFormElement;
    const switchBtn = this.container.querySelector('.switch-mode-btn') as HTMLButtonElement;
    const closeBtn = this.container.querySelector('.close-btn') as HTMLButtonElement | null;

    form?.addEventListener('submit', (e) => this.handleSubmit(e));
    switchBtn?.addEventListener('click', () => this.switchMode());
    closeBtn?.addEventListener('click', () => this.onCancel?.());
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();

    if (this.isLoading) return;

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const username = formData.get('username') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    // Validation
    if (this.mode === 'register') {
      if (password !== confirmPassword) {
        this.showError('Passwords do not match');
        return;
      }
    }

    this.isLoading = true;
    this.render();

    try {
      if (this.mode === 'login') {
        await authService.login(email, password);
      } else {
        await authService.register(email, username, password);
      }
      this.onSuccess();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private switchMode(): void {
    this.mode = this.mode === 'login' ? 'register' : 'login';
    this.render();
  }

  private showError(message: string): void {
    const errorDiv = this.container.querySelector('.error-message') as HTMLDivElement;
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
    }
  }

  private addStyles(): void {
    if (document.getElementById('login-screen-styles')) return;

    const style = document.createElement('style');
    style.id = 'login-screen-styles';
    style.textContent = `
      .login-screen {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1000;
      }

      .login-overlay {
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .login-modal {
        background: #1a1a2e;
        border: 2px solid #4a9f4a;
        border-radius: 8px;
        padding: 24px;
        width: 100%;
        max-width: 400px;
        color: #e0e0e0;
        font-family: 'Courier New', monospace;
      }

      .login-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
      }

      .login-header h2 {
        margin: 0;
        color: #4a9f4a;
        font-size: 24px;
      }

      .close-btn {
        background: none;
        border: none;
        color: #888;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }

      .close-btn:hover {
        color: #fff;
      }

      .form-group {
        margin-bottom: 16px;
      }

      .form-group label {
        display: block;
        margin-bottom: 4px;
        color: #aaa;
        font-size: 14px;
      }

      .form-group input {
        width: 100%;
        padding: 10px;
        background: #0d0d1a;
        border: 1px solid #333;
        border-radius: 4px;
        color: #fff;
        font-size: 16px;
        font-family: inherit;
        box-sizing: border-box;
      }

      .form-group input:focus {
        outline: none;
        border-color: #4a9f4a;
      }

      .error-message {
        background: #4a1f1f;
        border: 1px solid #8b3a3a;
        color: #ff6b6b;
        padding: 10px;
        border-radius: 4px;
        margin-bottom: 16px;
        font-size: 14px;
      }

      .submit-btn {
        width: 100%;
        padding: 12px;
        background: #4a9f4a;
        border: none;
        border-radius: 4px;
        color: #000;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.2s;
      }

      .submit-btn:hover:not(:disabled) {
        background: #5fbf5f;
      }

      .submit-btn:disabled {
        background: #333;
        color: #666;
        cursor: not-allowed;
      }

      .login-footer {
        margin-top: 20px;
        text-align: center;
        color: #888;
        font-size: 14px;
      }

      .login-footer p {
        margin: 0;
      }

      .switch-mode-btn {
        background: none;
        border: none;
        color: #4a9f4a;
        cursor: pointer;
        font-family: inherit;
        font-size: inherit;
        text-decoration: underline;
      }

      .switch-mode-btn:hover {
        color: #5fbf5f;
      }
    `;
    document.head.appendChild(style);
  }
}
