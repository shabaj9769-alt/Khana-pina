function isEditableTarget(target: EventTarget | null): boolean {
  const el =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return Boolean(
    el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  );
}

/**
 * Lightweight browser-level deterrents for the customer storefront in production.
 * Returns a cleanup function that removes all attached event listeners.
 */
export function enableCustomerCopyProtection(): () => void {
  if (!import.meta.env.PROD || typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const onContextMenu = (e: MouseEvent) => {
    if (!isEditableTarget(e.target)) {
      e.preventDefault();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const code = e.code;

    if (e.key === 'F12') {
      e.preventDefault();
      return;
    }

    // Windows / Linux shortcuts (do NOT block Ctrl+C/V/A/F)
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!e.shiftKey && (key === 'u' || code === 'KeyU' || key === 's' || code === 'KeyS')) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (key === 'i' || code === 'KeyI' || key === 'j' || code === 'KeyJ' || key === 'c' || code === 'KeyC')
      ) {
        e.preventDefault();
        return;
      }
    }

    // macOS Cmd+Option+I / U / J
    if (e.metaKey && e.altKey && !e.ctrlKey) {
      if (
        key === 'i' ||
        code === 'KeyI' ||
        key === 'u' ||
        code === 'KeyU' ||
        key === 'j' ||
        code === 'KeyJ'
      ) {
        e.preventDefault();
      }
    }
  };

  const onDragStart = (e: DragEvent) => {
    if (
      e.target instanceof HTMLImageElement ||
      (e.target instanceof Element && e.target.closest('img'))
    ) {
      e.preventDefault();
    }
  };

  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('dragstart', onDragStart);

  return () => {
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('dragstart', onDragStart);
  };
}
