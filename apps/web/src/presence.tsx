import { useEffect, useState } from 'preact/hooks';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Peer { id: string; name: string; pictureUrl: string | null }

const BEAT_MS = 60_000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

/** One face: the Google photo when there is one, otherwise initials. */
export function Face({ p }: { p: Peer }) {
  const [broken, setBroken] = useState(false);
  return (
    <span class="pz-face" title={`${p.name} · online now`} aria-label={`${p.name}, online now`}>
      {p.pictureUrl && !broken
        ? <img src={p.pictureUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span class="pz-init" aria-hidden="true">{initials(p.name)}</span>}
      <i class="pz-dot" aria-hidden="true" />
    </span>
  );
}

/**
 * Keeps this person marked as active while the tab is open, and lists the partners in the same branch who are active now.
 * Renders nothing for staff and head office (the server returns no partners for them) and when nobody else is online.
 */
export function PartnersOnline({ call }: { call: Call }) {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    let alive = true;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      call('POST', '/v1/presence').catch(() => undefined);
      call('GET', '/v1/presence/partners').then((r) => { if (alive) setPeers(r?.partners ?? []); }, () => undefined);
    };
    beat();
    const id = window.setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => { alive = false; window.clearInterval(id); document.removeEventListener('visibilitychange', beat); };
  }, [call]);
  if (peers.length === 0) return null;
  const shown = peers.slice(0, 6);
  const more = peers.length - shown.length;
  return (
    <div class="pz" role="group" aria-label={`${peers.length} partner${peers.length === 1 ? '' : 's'} online in your branch`}>
      {shown.map((p) => <Face key={p.id} p={p} />)}
      {more > 0 && <span class="pz-more" aria-label={`${more} more`}>+{more}</span>}
    </div>
  );
}
