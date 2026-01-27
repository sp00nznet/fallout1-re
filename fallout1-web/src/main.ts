/**
 * Fallout 1 HTML5 Port - Main Entry Point
 */

import { Engine, createEngine } from '@/core/Engine';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '@/platform/graphics/Renderer';
import { TouchManager } from '@/platform/input/TouchManager';
import { getSaveManager } from '@/platform/storage/SaveManager';

// Loading screen elements
const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');

function updateLoading(progress: number, text: string): void {
  if (loadingBar) {
    loadingBar.style.width = `${progress}%`;
  }
  if (loadingText) {
    loadingText.textContent = text;
  }
}

function hideLoading(): void {
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element not found');
  }

  // Calculate optimal scale for the display
  const containerWidth = window.innerWidth;
  const containerHeight = window.innerHeight;
  const scaleX = Math.floor(containerWidth / SCREEN_WIDTH);
  const scaleY = Math.floor(containerHeight / SCREEN_HEIGHT);
  const scale = Math.max(1, Math.min(scaleX, scaleY));

  updateLoading(10, 'Initializing engine...');

  // Create engine
  const engine = await createEngine({
    canvas,
    scale,
    targetFPS: 60,
    assetPath: '/assets'
  });

  updateLoading(30, 'Initializing storage...');

  // Initialize save manager
  const saveManager = getSaveManager();
  await saveManager.initialize();

  updateLoading(50, 'Setting up input...');

  // Create touch manager for mobile support
  const touchManager = new TouchManager({
    canvas,
    screenWidth: SCREEN_WIDTH,
    screenHeight: SCREEN_HEIGHT,
    scale
  });

  // Handle touch gestures
  touchManager.onGesture((event) => {
    if (event.type === 'tap') {
      console.log(`Tap at (${event.x}, ${event.y})`);
    } else if (event.type === 'longpress') {
      console.log(`Long press at (${event.x}, ${event.y})`);
    }
  });

  updateLoading(70, 'Loading assets...');

  // Demo: draw something to show the engine works
  engine.onRender((renderer) => {
    // Clear to dark blue
    renderer.clear(0);

    // Draw a simple test pattern
    const time = engine.getTicks() / 60;

    // Draw moving rectangles
    for (let i = 0; i < 5; i++) {
      const x = 100 + Math.sin(time + i * 0.5) * 200;
      const y = 100 + Math.cos(time + i * 0.5) * 150;
      const colorIndex = 50 + i * 20;
      renderer.fillRect(Math.floor(x), Math.floor(y), 50, 50, colorIndex);
    }

    // Draw border
    renderer.drawBox(10, 10, SCREEN_WIDTH - 11, SCREEN_HEIGHT - 11, 200);

    // Draw FPS counter area
    renderer.fillRect(SCREEN_WIDTH - 70, 15, 55, 20, 0);
  });

  // Update callback for game logic
  engine.onUpdate((_state) => {
    // Handle keyboard input
    const key = engine.input.getKey();
    if (key) {
      if (key.code === 'Escape') {
        engine.setPaused(!engine.isPaused());
      }
    }

    // Handle virtual joystick for movement
    const joystick = touchManager.getJoystick();
    if (joystick.active) {
      // Use joystick.dx and joystick.dy for movement
      // console.log(`Joystick: ${joystick.dx.toFixed(2)}, ${joystick.dy.toFixed(2)}`);
    }
  });

  updateLoading(90, 'Starting game...');

  // Start the game loop
  engine.start();

  updateLoading(100, 'Ready!');

  // Hide loading screen after a short delay
  setTimeout(() => {
    hideLoading();
  }, 500);

  // Handle window resize
  window.addEventListener('resize', () => {
    const newScaleX = Math.floor(window.innerWidth / SCREEN_WIDTH);
    const newScaleY = Math.floor(window.innerHeight / SCREEN_HEIGHT);
    const newScale = Math.max(1, Math.min(newScaleX, newScaleY));

    engine.setScale(newScale);
    touchManager.setScale(newScale);
  });

  // Expose engine for debugging
  (window as unknown as { engine: Engine }).engine = engine;

  console.log('Fallout 1 HTML5 Port initialized');
  console.log(`Screen: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}, Scale: ${scale}x`);
  console.log('Press ESC to pause/unpause');
}

// Start the application
main().catch((error) => {
  console.error('Failed to start:', error);
  updateLoading(0, `Error: ${error.message}`);
});
