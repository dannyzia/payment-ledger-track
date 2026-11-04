export interface DragOptions {
  storageKey?: string;
  positionMode?: 'free' | 'bottom' | 'left' | 'right';
  onSnap?: (position: { x: number; y: number; isLowerHalf: boolean }) => void;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function isOverlapping(r1: Rect, r2: Rect): boolean {
  return !(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom);
}

export function snapToEdge(
  x: number,
  y: number,
  menuDim: { width: number; height: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const snapX = x + menuDim.width / 2 < viewport.width / 2
    ? 24
    : viewport.width - menuDim.width - 24;

  const clampY = Math.max(12, Math.min(viewport.height - menuDim.height - 24, y));
  return { x: snapX, y: clampY };
}

export function getPinnedPosition(
  mode: 'bottom' | 'left' | 'right',
  menuDim: { width: number; height: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const y = Math.max(12, viewport.height - menuDim.height - 24);
  if (mode === 'bottom') {
    return { x: Math.max(12, (viewport.width - menuDim.width) / 2), y };
  }
  if (mode === 'left') {
    return { x: 24, y };
  }
  return { x: Math.max(12, viewport.width - menuDim.width - 24), y };
}

export function calculateAvoidance(
  currentPos: { x: number; y: number },
  menuDim: { width: number; height: number },
  forbiddenRects: Rect[],
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const menuRect: Rect = {
    left: currentPos.x,
    top: currentPos.y,
    right: currentPos.x + menuDim.width,
    bottom: currentPos.y + menuDim.height,
  };

  const collidingRect = forbiddenRects.find((rect) => isOverlapping(menuRect, rect));
  if (!collidingRect) {
    return currentPos;
  }

  // Check right margin dodge
  const rightDodgeX = viewport.width - menuDim.width - 24;
  const rightRect: Rect = { left: rightDodgeX, top: currentPos.y, right: rightDodgeX + menuDim.width, bottom: currentPos.y + menuDim.height };
  if (!forbiddenRects.some((r) => isOverlapping(rightRect, r))) {
    return { x: rightDodgeX, y: currentPos.y };
  }

  // Check left margin dodge
  const leftDodgeX = 24;
  const leftRect: Rect = { left: leftDodgeX, top: currentPos.y, right: leftDodgeX + menuDim.width, bottom: currentPos.y + menuDim.height };
  if (!forbiddenRects.some((r) => isOverlapping(leftRect, r))) {
    return { x: leftDodgeX, y: currentPos.y };
  }

  // Horizontal dodge unavailable (e.g. full-width button); dodge vertically above colliding button
  const safeY = Math.max(12, collidingRect.top - menuDim.height - 12);
  return { x: currentPos.x, y: safeY };
}

export function draggable(node: HTMLElement, initialOptions: DragOptions = {}) {
  let options = initialOptions;
  let isDragging = false;
  let hasMovedPastThreshold = false;
  let originClientX = 0;
  let originClientY = 0;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let lastTapTime = 0;
  const DRAG_THRESHOLD = 6;

  function getDockedCoords(): { x: number; y: number } {
    const dimWidth = node.offsetWidth || 140;
    const dimHeight = node.offsetHeight || 48;
    const defaultX = window.innerWidth - dimWidth - 24;
    const defaultY = window.innerHeight - dimHeight - 24;
    return { x: Math.max(12, defaultX), y: Math.max(12, defaultY) };
  }

  function loadInitialPosition(): { x: number; y: number } {
    const menuDim = { width: node.offsetWidth || 140, height: node.offsetHeight || 48 };
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    if (options.positionMode && options.positionMode !== 'free') {
      return getPinnedPosition(options.positionMode, menuDim, viewport);
    }

    if (options.storageKey && typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(options.storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            return {
              x: Math.max(12, Math.min(viewport.width - menuDim.width - 12, parsed.x)),
              y: Math.max(12, Math.min(viewport.height - menuDim.height - 12, parsed.y)),
            };
          }
        } catch {}
      }
    }
    return getDockedCoords();
  }

  const initial = loadInitialPosition();
  currentX = initial.x;
  currentY = initial.y;
  updatePosition(currentX, currentY);
  notifySnap();

  function updatePosition(x: number, y: number) {
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function notifySnap() {
    const isLowerHalf = currentY > window.innerHeight / 2;
    options.onSnap?.({ x: currentX, y: currentY, isLowerHalf });
  }

  function resetToDocked() {
    const docked = getDockedCoords();
    currentX = docked.x;
    currentY = docked.y;
    node.style.transition = 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    updatePosition(currentX, currentY);

    if (options.storageKey && typeof localStorage !== 'undefined') {
      localStorage.setItem(options.storageKey, JSON.stringify({ x: currentX, y: currentY }));
    }
    notifySnap();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;

    const now = Date.now();
    if (now - lastTapTime < 300) {
      resetToDocked();
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    if (options.positionMode && options.positionMode !== 'free') return;

    hasMovedPastThreshold = false;
    originClientX = e.clientX;
    originClientY = e.clientY;
    startX = e.clientX - currentX;
    startY = e.clientY - currentY;
  }

  function onPointerMove(e: PointerEvent) {
    if (!hasMovedPastThreshold && (Math.hypot(e.clientX - originClientX, e.clientY - originClientY) > DRAG_THRESHOLD)) {
      hasMovedPastThreshold = true;
      isDragging = true;
      node.setPointerCapture(e.pointerId);
      node.style.transition = 'none';
    }

    if (!isDragging) return;
    currentX = e.clientX - startX;
    currentY = e.clientY - startY;
    updatePosition(currentX, currentY);
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDragging) {
      hasMovedPastThreshold = false;
      return;
    }
    isDragging = false;
    hasMovedPastThreshold = false;

    if (node.hasPointerCapture(e.pointerId)) {
      node.releasePointerCapture(e.pointerId);
    }

    const forbiddenElements = [
      document.getElementById('btn-save'),
      document.getElementById('btn-submit'),
    ].filter((el): el is HTMLElement => el !== null);

    const forbiddenRects = forbiddenElements.map((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    });

    const menuDim = { width: node.offsetWidth, height: node.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    const snapped = snapToEdge(currentX, currentY, menuDim, viewport);
    const safePos = calculateAvoidance(snapped, menuDim, forbiddenRects, viewport);

    currentX = Math.max(12, Math.min(viewport.width - menuDim.width - 12, safePos.x));
    currentY = Math.max(12, Math.min(viewport.height - menuDim.height - 12, safePos.y));

    node.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    updatePosition(currentX, currentY);

    if (options.storageKey && typeof localStorage !== 'undefined') {
      localStorage.setItem(options.storageKey, JSON.stringify({ x: currentX, y: currentY }));
    }
    notifySnap();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (options.positionMode && options.positionMode !== 'free') return;
    const step = 20;
    let moved = false;

    if (e.key === 'ArrowUp') {
      currentY = Math.max(12, currentY - step);
      moved = true;
    } else if (e.key === 'ArrowDown') {
      currentY = Math.min(window.innerHeight - node.offsetHeight - 12, currentY + step);
      moved = true;
    } else if (e.key === 'ArrowLeft') {
      currentX = Math.max(12, currentX - step);
      moved = true;
    } else if (e.key === 'ArrowRight') {
      currentX = Math.min(window.innerWidth - node.offsetWidth - 12, currentX + step);
      moved = true;
    }

    if (moved) {
      e.preventDefault();
      node.style.transition = 'transform 100ms ease';
      updatePosition(currentX, currentY);
      if (options.storageKey && typeof localStorage !== 'undefined') {
        localStorage.setItem(options.storageKey, JSON.stringify({ x: currentX, y: currentY }));
      }
      notifySnap();
    }
  }

  function onResize() {
    const menuDim = { width: node.offsetWidth || 140, height: node.offsetHeight || 48 };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (options.positionMode && options.positionMode !== 'free') {
      const pinned = getPinnedPosition(options.positionMode, menuDim, viewport);
      currentX = pinned.x;
      currentY = pinned.y;
    } else {
      currentX = Math.max(12, Math.min(viewport.width - menuDim.width - 12, currentX));
      currentY = Math.max(12, Math.min(viewport.height - menuDim.height - 12, currentY));
    }
    updatePosition(currentX, currentY);
    notifySnap();
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerUp);
  node.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  return {
    update(newOptions: DragOptions) {
      options = newOptions;
      if (options.positionMode && options.positionMode !== 'free') {
        const menuDim = { width: node.offsetWidth || 140, height: node.offsetHeight || 48 };
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const pinned = getPinnedPosition(options.positionMode, menuDim, viewport);
        currentX = pinned.x;
        currentY = pinned.y;
        node.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        updatePosition(currentX, currentY);
        notifySnap();
      }
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
      node.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    },
  };
}
