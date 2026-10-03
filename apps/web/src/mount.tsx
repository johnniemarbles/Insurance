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
  render(<App host={host} />, mount);
  return () => render(null, mount);
}
