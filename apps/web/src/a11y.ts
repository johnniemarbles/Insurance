import { useEffect, useRef } from 'preact/hooks';

/** Moves keyboard focus into a panel when it opens and gives it back to what had focus when it closes. */
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = el.getRootNode() as Document | ShadowRoot;
    const before = root.activeElement as HTMLElement | null;
    el.focus();
    return () => { if (before && before.isConnected) before.focus(); };
  }, []);
  return ref;
}

/** Arrow keys, Home and End move between the tabs of a tab list, as screen-reader users and keyboard users expect. */
export function tabArrows(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null;
  if (!t || t.getAttribute?.('role') !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = Array.from(t.parentElement?.querySelectorAll<HTMLElement>('[role=tab]') ?? []);
  const i = tabs.indexOf(t); if (i < 0 || tabs.length < 2) return;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault(); tabs[next]!.focus(); tabs[next]!.click();
}
