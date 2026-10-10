import { useEffect, useRef } from 'react';

export function useDialogFocus(onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && close.current) { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab' || !node) return;
      const buttons = Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(e => e.getClientRects().length);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    node?.addEventListener('keydown', handle);
    return () => { node?.removeEventListener('keydown', handle); if (previous?.isConnected) previous.focus(); };
  }, []);
  return ref;
}
