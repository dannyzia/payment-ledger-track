import { describe, it, expect } from 'vitest';
import {
  calculateAvoidance,
  isOverlapping,
  snapToEdge,
  getPinnedPosition,
  type Rect,
} from './actions/draggable';

describe('Draggable Collision Avoidance and Snapping', () => {
  it('detects bounding box overlap correctly', () => {
    const r1: Rect = { left: 10, top: 10, right: 50, bottom: 50 };
    const r2: Rect = { left: 40, top: 40, right: 80, bottom: 80 };
    const r3: Rect = { left: 100, top: 100, right: 150, bottom: 150 };

    expect(isOverlapping(r1, r2)).toBe(true);
    expect(isOverlapping(r1, r3)).toBe(false);
  });

  it('dodges to left margin when right side collides with Save button', () => {
    const menuDim = { width: 140, height: 48 };
    const viewport = { width: 400, height: 800 };
    const forbiddenRect: Rect = { left: 240, top: 720, right: 380, bottom: 780 };

    const collidingPos = { x: 250, y: 730 };
    const resolved = calculateAvoidance(collidingPos, menuDim, [forbiddenRect], viewport);

    expect(resolved.x).toBe(24);
    expect(resolved.y).toBe(730);
  });

  it('dodges vertically above button when colliding with full-width primary button', () => {
    const menuDim = { width: 140, height: 48 };
    const viewport = { width: 400, height: 800 };
    // Full width bottom Save button spanning across screen
    const fullWidthBtn: Rect = { left: 16, top: 720, right: 384, bottom: 780 };

    const collidingPos = { x: 236, y: 730 };
    const resolved = calculateAvoidance(collidingPos, menuDim, [fullWidthBtn], viewport);

    // Cannot dodge left or right; must dodge above button (720 - 48 - 12 = 660)
    expect(resolved.y).toBe(660);
  });

  it('snaps to nearest screen edge (left vs right)', () => {
    const menuDim = { width: 120, height: 48 };
    const viewport = { width: 400, height: 800 };

    // Closer to left edge
    const snapLeft = snapToEdge(50, 400, menuDim, viewport);
    expect(snapLeft.x).toBe(24);

    // Closer to right edge
    const snapRight = snapToEdge(300, 400, menuDim, viewport);
    expect(snapRight.x).toBe(400 - 120 - 24); // 256
  });

  it('computes correct coordinates for pinned position modes', () => {
    const menuDim = { width: 120, height: 48 };
    const viewport = { width: 400, height: 800 };

    const leftPin = getPinnedPosition('left', menuDim, viewport);
    expect(leftPin.x).toBe(24);
    expect(leftPin.y).toBe(800 - 48 - 24);

    const rightPin = getPinnedPosition('right', menuDim, viewport);
    expect(rightPin.x).toBe(400 - 120 - 24);
    expect(rightPin.y).toBe(800 - 48 - 24);

    const bottomPin = getPinnedPosition('bottom', menuDim, viewport);
    expect(bottomPin.x).toBe((400 - 120) / 2);
    expect(bottomPin.y).toBe(800 - 48 - 24);
  });
});
