/** An error with a way out: Try again re-runs the screen (the Shell listens and remounts it). */
export function ErrorBar({ msg, retry }: { msg: string; retry: string }) {
  return (
    <div class="err errbar" role="alert">
      <span>{msg}</span>
      <button class="btn quiet" onClick={() => window.dispatchEvent(new CustomEvent('pii-retry'))}>{retry}</button>
    </div>
  );
}
