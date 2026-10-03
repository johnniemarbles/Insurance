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
