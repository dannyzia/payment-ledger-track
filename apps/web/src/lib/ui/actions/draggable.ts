export interface DragOptions {
  storageKey?: string;
  positionMode?: 'free' | 'bottom' | 'left' | 'right';
  onSnap?: (position: { x: number; y: number; isLowerHalf: boolean; source?: string }) => void;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, [role="button"], [contenteditable="true"]';

/** True when a pointer press landed on a control that owns its own activation. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
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
  // CLT-T-050: a valid drag origin only exists after a pointerdown on the
  // node's own surface; without this flag a stale origin from an earlier drag
  // turns a press-and-move on a child into a captured drag.
  let hasOrigin = false;
  let hasUserPosition = false;
  // CLT-R-013: Android's touch-target adjustment retargets a press on the
  // pill's narrow neutral strips to the nearest link or button, so requiring a
  // non-interactive origin made the menu undraggable by finger (the drag guard
  // correctly refused the retargeted press). The origin no longer decides:
  // movement past the threshold is a drag even when the press began on a
  // control, and the one click belonging to that release is swallowed so the
  // control does not also activate. A press without movement stays a tap and is
  // left completely untouched — that is what keeps New Entry and the toggle
  // working (CLT-T-050).
  let pressStartedOnControl = false;
  let suppressClick = false;
  const DRAG_THRESHOLD = 6;

  // Page-level primary actions the pill must not cover. Any visible `button[id^="btn-"]`
  // counts (Save, Supersede, Reconcile Statement, …), excluding the menu's own controls.
  function getForbiddenRects(): Rect[] {
    if (typeof document === 'undefined') return [];
    return [...document.querySelectorAll<HTMLElement>('#btn-save, #btn-submit, button[id^="btn-"]')]
      .filter((el) => !node.contains(el))
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0)
      .map((b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom }));
  }

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

  // CLT-T-050: the first pass can run before the pill has its final size — the
  // label text and font decide it — so the dock was computed from the 140x48
  // fallbacks and settled partly off-screen, which put the region, not its
  // controls, under the user's finger. Re-measure once layout is real, and
  // again whenever the pill's size changes, unless the user placed it.
  const hasStoredPosition = (() => {
    try {
      return Boolean(
        options.storageKey &&
          typeof localStorage !== 'undefined' &&
          localStorage.getItem(options.storageKey),
      );
    } catch {
      return false;
    }
  })();

  // CLT-R-018: above the md breakpoint the pill is display:none, so it measures
  // 0x0. Clamping with the 0x0 (or fallback) size then wrote a bogus position
  // that survived the rotation back to portrait — a landscape trip moved the
  // menu from y=618 to y=323 while storage still said 618. Do nothing until the
  // pill has a real box again; the ResizeObserver settles it when it reappears.
  function isMeasurable(): boolean {
    return node.offsetWidth > 0 && node.offsetHeight > 0;
  }

  function settleDock() {
    if (isDragging) return;
    if (!isMeasurable()) return;
    if (options.positionMode && options.positionMode !== 'free') return;

    const menuDim = { width: node.offsetWidth || 140, height: node.offsetHeight || 48 };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const previousX = currentX;
    const previousY = currentY;

    if (hasUserPosition || hasStoredPosition) {
      // Keep the user's placement, but never leave it off-screen.
      currentX = Math.max(12, Math.min(viewport.width - menuDim.width - 12, currentX));
      currentY = Math.max(12, Math.min(viewport.height - menuDim.height - 12, currentY));
    } else {
      const docked = getDockedCoords();
      currentX = docked.x;
      currentY = docked.y;
    }

    // The docked position sits in the bottom-right corner, which is exactly where
    // page-level primary actions live (#btn-save and friends). Dodge at rest too,
    // not only after a drag, or the pill swallows taps on the button underneath it.
    const safe = calculateAvoidance({ x: currentX, y: currentY }, menuDim, getForbiddenRects(), viewport);
    currentX = Math.max(12, Math.min(viewport.width - menuDim.width - 12, safe.x));
    currentY = Math.max(12, Math.min(viewport.height - menuDim.height - 12, safe.y));

    if (Math.abs(previousX - currentX) < 1 && Math.abs(previousY - currentY) < 1) return;

    updatePosition(currentX, currentY);
    notifySnap();
  }

  const settleFrame =
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(settleDock) : null;
  const dockObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => settleDock()) : null;
  dockObserver?.observe(node);

  // Pages render their action buttons asynchronously (data loads after mount), so the
  // pill must re-check for a colliding action when the DOM changes, not only on resize.
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSettle = () => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      settleDock();
    }, 150);
  };
  const bodyObserver =
    typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => scheduleSettle())
      : null;
  if (bodyObserver && typeof document !== 'undefined') {
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  function updatePosition(x: number, y: number) {
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function notifySnap(source?: string) {
    const isLowerHalf = currentY > window.innerHeight / 2;
    // source: 'drag' marks an active pointer-drag release (Plan 019 §10.4:
    // haptics fire only there); initialization and keyboard nudges pass none
    options.onSnap?.({ x: currentX, y: currentY, isLowerHalf, source });
  }

  function resetToDocked() {
    const docked = getDockedCoords();
    currentX = docked.x;
    currentY = docked.y;
    hasUserPosition = false;
    node.style.transition = 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    updatePosition(currentX, currentY);

    if (options.storageKey && typeof localStorage !== 'undefined') {
      localStorage.setItem(options.storageKey, JSON.stringify({ x: currentX, y: currentY }));
    }
    notifySnap();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;

    // A new press starts a new interaction: any suppression owed to a previous
    // drag release is spent.
    suppressClick = false;

    const onControl = isInteractiveTarget(e.target);
    pressStartedOnControl = onControl;

    // Double-tap reset is a gesture on the pill's own surface. On a control it
    // would fight the control's activation (double-tapping New Entry must not
    // also re-dock the menu).
    if (!onControl) {
      const now = Date.now();
      if (now - lastTapTime < 300) {
        resetToDocked();
        lastTapTime = 0;
        hasOrigin = false;
        return;
      }
      lastTapTime = now;
    }

    if (options.positionMode && options.positionMode !== 'free') return;

    hasMovedPastThreshold = false;
    hasOrigin = true;
    originClientX = e.clientX;
    originClientY = e.clientY;
    startX = e.clientX - currentX;
    startY = e.clientY - currentY;

    // CLT-T-050: never capture a press that may still turn out to be a tap on a
    // control — capture retargets the click to the region and the control's
    // navigation/onclick never fires. The capture is taken below, on the first
    // move instead.
    if (onControl) return;

    // Capture from the press itself. Waiting for the first move loses a fast
    // drag: the pointer leaves the pill before any move event lands on it, so
    // the drag never starts (touch input hides this behind implicit capture).
    // Only presses on the neutral surface reach here, never a control's.
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; the drag still works while the pointer stays on the node.
    }
  }

  // Swallow exactly the click that follows a drag which started on a control.
  // Capture phase, so it runs before the anchor's navigation and before any
  // child onclick handler.
  function onClickCapture(e: MouseEvent) {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerMove(e: PointerEvent) {
    if (!hasOrigin) return;
    if (!hasMovedPastThreshold && (Math.hypot(e.clientX - originClientX, e.clientY - originClientY) > DRAG_THRESHOLD)) {
      hasMovedPastThreshold = true;
      isDragging = true;
      node.style.transition = 'none';

      if (pressStartedOnControl) {
        // The gesture turned out to be a drag, not an activation.
        suppressClick = true;
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          // best-effort, as above
        }
      }
    }

    if (!isDragging) return;
    currentX = e.clientX - startX;
    currentY = e.clientY - startY;
    updatePosition(currentX, currentY);
  }

  function onPointerUp(e: PointerEvent) {
    hasOrigin = false;
    if (!isDragging) {
      hasMovedPastThreshold = false;
      return;
    }
    isDragging = false;
    hasMovedPastThreshold = false;
    hasUserPosition = true;

    if (node.hasPointerCapture(e.pointerId)) {
      node.releasePointerCapture(e.pointerId);
    }

    const forbiddenRects = getForbiddenRects();

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
    notifySnap('drag');
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
      hasUserPosition = true;
      node.style.transition = 'transform 100ms ease';
      updatePosition(currentX, currentY);
      if (options.storageKey && typeof localStorage !== 'undefined') {
        localStorage.setItem(options.storageKey, JSON.stringify({ x: currentX, y: currentY }));
      }
      notifySnap();
    }
  }

  function onResize() {
    if (!isMeasurable()) return;
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
  node.addEventListener('click', onClickCapture, true);
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
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      if (settleTimer !== null) clearTimeout(settleTimer);
      dockObserver?.disconnect();
      bodyObserver?.disconnect();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
      node.removeEventListener('click', onClickCapture, true);
      node.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    },
  };
}
