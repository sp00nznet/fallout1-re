/**
 * Button System - Port of plib/gnw/button.c
 * Handles clickable UI buttons with states
 */

import { Rect, createRect, rectContainsPoint } from '@/utils/Rect';

export const enum ButtonFlags {
  None = 0,
  Disabled = 0x01,
  Pressed = 0x02,
  Hover = 0x04,
  Toggle = 0x08,
  Checked = 0x10,
  RadioButton = 0x20,
  Repeat = 0x40,
  Hidden = 0x80
}

export interface ButtonImages {
  normal: Uint8Array | null;
  pressed: Uint8Array | null;
  hover: Uint8Array | null;
  disabled: Uint8Array | null;
}

export interface Button {
  id: number;
  rect: Rect;
  flags: number;
  images: ButtonImages;
  pressedCallback?: (() => void) | undefined;
  releasedCallback?: (() => void) | undefined;
  hoverCallback?: (() => void) | undefined;
  keyCode?: number;  // Keyboard shortcut
  groupId?: number;  // For radio buttons
}

export type ButtonCallback = () => void;

/**
 * Button manager for a window
 */
export class ButtonManager {
  private buttons: Map<number, Button> = new Map();
  private nextButtonId = 1;
  private hoveredButton: Button | null = null;
  private pressedButton: Button | null = null;

  /**
   * Create a button
   */
  createButton(
    x: number,
    y: number,
    width: number,
    height: number,
    images: Partial<ButtonImages> = {},
    flags: number = ButtonFlags.None
  ): number {
    const id = this.nextButtonId++;

    const button: Button = {
      id,
      rect: createRect(x, y, x + width - 1, y + height - 1),
      flags,
      images: {
        normal: images.normal ?? null,
        pressed: images.pressed ?? null,
        hover: images.hover ?? null,
        disabled: images.disabled ?? null
      }
    };

    this.buttons.set(id, button);
    return id;
  }

  /**
   * Delete a button
   */
  deleteButton(id: number): void {
    const button = this.buttons.get(id);
    if (!button) return;

    if (this.hoveredButton === button) {
      this.hoveredButton = null;
    }
    if (this.pressedButton === button) {
      this.pressedButton = null;
    }

    this.buttons.delete(id);
  }

  /**
   * Set button callbacks
   */
  setCallbacks(
    id: number,
    onPressed?: ButtonCallback,
    onReleased?: ButtonCallback,
    onHover?: ButtonCallback
  ): void {
    const button = this.buttons.get(id);
    if (!button) return;

    button.pressedCallback = onPressed;
    button.releasedCallback = onReleased;
    button.hoverCallback = onHover;
  }

  /**
   * Set button keyboard shortcut
   */
  setKeyCode(id: number, keyCode: number): void {
    const button = this.buttons.get(id);
    if (button) {
      button.keyCode = keyCode;
    }
  }

  /**
   * Set button flags
   */
  setFlags(id: number, flags: number): void {
    const button = this.buttons.get(id);
    if (button) {
      button.flags = flags;
    }
  }

  /**
   * Enable/disable button
   */
  setEnabled(id: number, enabled: boolean): void {
    const button = this.buttons.get(id);
    if (button) {
      if (enabled) {
        button.flags &= ~ButtonFlags.Disabled;
      } else {
        button.flags |= ButtonFlags.Disabled;
      }
    }
  }

  /**
   * Show/hide button
   */
  setVisible(id: number, visible: boolean): void {
    const button = this.buttons.get(id);
    if (button) {
      if (visible) {
        button.flags &= ~ButtonFlags.Hidden;
      } else {
        button.flags |= ButtonFlags.Hidden;
      }
    }
  }

  /**
   * Set toggle state for toggle buttons
   */
  setChecked(id: number, checked: boolean): void {
    const button = this.buttons.get(id);
    if (!button || !(button.flags & ButtonFlags.Toggle)) return;

    if (checked) {
      button.flags |= ButtonFlags.Checked;
    } else {
      button.flags &= ~ButtonFlags.Checked;
    }
  }

  /**
   * Get toggle state
   */
  isChecked(id: number): boolean {
    const button = this.buttons.get(id);
    return button ? (button.flags & ButtonFlags.Checked) !== 0 : false;
  }

  /**
   * Set button group for radio buttons
   */
  setGroup(id: number, groupId: number): void {
    const button = this.buttons.get(id);
    if (button) {
      button.groupId = groupId;
      button.flags |= ButtonFlags.RadioButton;
    }
  }

  /**
   * Handle mouse move
   * @returns Button id if hovering, -1 otherwise
   */
  handleMouseMove(x: number, y: number): number {
    const oldHovered = this.hoveredButton;
    this.hoveredButton = null;

    for (const button of this.buttons.values()) {
      if (button.flags & (ButtonFlags.Disabled | ButtonFlags.Hidden)) continue;

      if (rectContainsPoint(button.rect, x, y)) {
        this.hoveredButton = button;
        button.flags |= ButtonFlags.Hover;

        if (oldHovered !== button) {
          button.hoverCallback?.();
        }

        return button.id;
      }
    }

    if (oldHovered) {
      oldHovered.flags &= ~ButtonFlags.Hover;
    }

    return -1;
  }

  /**
   * Handle mouse down
   * @returns Button id if pressed, -1 otherwise
   */
  handleMouseDown(x: number, y: number): number {
    for (const button of this.buttons.values()) {
      if (button.flags & (ButtonFlags.Disabled | ButtonFlags.Hidden)) continue;

      if (rectContainsPoint(button.rect, x, y)) {
        this.pressedButton = button;
        button.flags |= ButtonFlags.Pressed;
        button.pressedCallback?.();
        return button.id;
      }
    }

    return -1;
  }

  /**
   * Handle mouse up
   * @returns Button id if released on button, -1 otherwise
   */
  handleMouseUp(x: number, y: number): number {
    const pressed = this.pressedButton;
    this.pressedButton = null;

    if (!pressed) return -1;

    pressed.flags &= ~ButtonFlags.Pressed;

    // Check if released on the same button
    if (rectContainsPoint(pressed.rect, x, y)) {
      // Handle toggle
      if (pressed.flags & ButtonFlags.Toggle) {
        pressed.flags ^= ButtonFlags.Checked;
      }

      // Handle radio buttons
      if (pressed.flags & ButtonFlags.RadioButton && pressed.groupId !== undefined) {
        for (const button of this.buttons.values()) {
          if (button.groupId === pressed.groupId && button !== pressed) {
            button.flags &= ~ButtonFlags.Checked;
          }
        }
        pressed.flags |= ButtonFlags.Checked;
      }

      pressed.releasedCallback?.();
      return pressed.id;
    }

    return -1;
  }

  /**
   * Handle key press
   * @returns Button id if key matches, -1 otherwise
   */
  handleKeyPress(keyCode: number): number {
    for (const button of this.buttons.values()) {
      if (button.flags & (ButtonFlags.Disabled | ButtonFlags.Hidden)) continue;

      if (button.keyCode === keyCode) {
        button.pressedCallback?.();
        button.releasedCallback?.();

        if (button.flags & ButtonFlags.Toggle) {
          button.flags ^= ButtonFlags.Checked;
        }

        return button.id;
      }
    }

    return -1;
  }

  /**
   * Get button at position
   */
  getButtonAt(x: number, y: number): number {
    for (const button of this.buttons.values()) {
      if (button.flags & ButtonFlags.Hidden) continue;
      if (rectContainsPoint(button.rect, x, y)) {
        return button.id;
      }
    }
    return -1;
  }

  /**
   * Get current image for button state
   */
  getButtonImage(id: number): Uint8Array | null {
    const button = this.buttons.get(id);
    if (!button) return null;

    if (button.flags & ButtonFlags.Disabled) {
      return button.images.disabled ?? button.images.normal;
    }
    if (button.flags & (ButtonFlags.Pressed | ButtonFlags.Checked)) {
      return button.images.pressed ?? button.images.normal;
    }
    if (button.flags & ButtonFlags.Hover) {
      return button.images.hover ?? button.images.normal;
    }

    return button.images.normal;
  }

  /**
   * Get button rect
   */
  getButtonRect(id: number): Rect | null {
    const button = this.buttons.get(id);
    return button ? { ...button.rect } : null;
  }

  /**
   * Get all buttons
   */
  getButtons(): Button[] {
    return Array.from(this.buttons.values());
  }

  /**
   * Draw all buttons to a buffer
   */
  drawButtons(buffer: Uint8Array, bufferWidth: number, _bufferHeight: number): void {
    for (const button of this.buttons.values()) {
      if (button.flags & ButtonFlags.Hidden) continue;

      const image = this.getButtonImage(button.id);
      if (!image) continue;

      const { ulx, uly, lrx, lry } = button.rect;
      const width = lrx - ulx + 1;
      const height = lry - uly + 1;

      // Simple blit (no transparency for buttons)
      for (let y = 0; y < height; y++) {
        const srcOffset = y * width;
        const destOffset = (uly + y) * bufferWidth + ulx;
        buffer.set(image.subarray(srcOffset, srcOffset + width), destOffset);
      }
    }
  }

  /**
   * Clear all buttons
   */
  clear(): void {
    this.buttons.clear();
    this.hoveredButton = null;
    this.pressedButton = null;
  }
}
