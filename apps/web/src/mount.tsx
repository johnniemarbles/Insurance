import { render } from 'preact';
import { App } from './app.tsx';
import { CSS } from './styles.ts';
import type { HostOptions } from './types.ts';

/** Renders the PII app inside a shadow root so Gmail's styles and ours never touch each other. */
export function mountPii(el: HTMLElement, host: HostOptions): () => void {
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const mount = document.createElement('div');
  mount.style.cssText = 'height:100%;display:flex;flex-direction:column';
  root.replaceChildren(style, mount);
  // Side panels stay on screen while the page scrolls: they are pinned to the visible part of this host.
  const pin = () => { const r = el.getBoundingClientRect(); mount.style.setProperty('--pii-top', `${Math.max(0, Math.round(r.top))}px`); mount.style.setProperty('--pii-right', `${Math.max(0, Math.round(window.innerWidth - r.right))}px`); };
  pin();
  const timer = setInterval(pin, 250);
  window.addEventListener('resize', pin); window.addEventListener('scroll', pin, true);
  render(<App host={host} />, mount);
  return () => { clearInterval(timer); window.removeEventListener('resize', pin); window.removeEventListener('scroll', pin, true); render(null, mount); };
}
