"use client";

import { useCallback, useRef } from "react";

/**
 * Long-press (touch or mouse) that doesn't also fire the click. Moving more than
 * `tolerance` px cancels it, so scrolling and dragging still work.
 */
export function useLongPress(onLongPress: () => void, onClick: () => void, { delay = 450, tolerance = 8 } = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, delay);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > tolerance) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => {
      // Right-click / iOS long-press menu → same as long-press.
      e.preventDefault();
      if (!fired.current) onLongPress();
      fired.current = true;
      clear();
    },
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onClick();
    },
  };
}
