import React, { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { NEBULA_SRV } from '../lib/endpoint';

// T25 3.2 (R-A-2026-08-15-008): runtime lookup > env > legacy localhost.
const POLL_MS = 15000;

interface SubscriberStatusData {
  up: boolean;
  state: string | null;
  backendSince: string | null;
  backendPid: number | null;
}

/**
 * Live "subscriber down" indicator for the TopBar. Polls nebula-srv's
 * read-only /api/cascade/subscriber-status, which probes pg_stat_activity
 * for the cascade interactive-turn subscriber's tagged PG connection. When
 * the daemon dies, its socket closes and the backend vanishes — the dot
 * turns red BEFORE the user sends, so they don't hit the silent 90s
 * no-response timeout.
 */
export function SubscriberStatus() {
  const [status, setStatus] = useState<SubscriberStatusData | null>(null);
  const [nebulaSrv, setNebulaSrv] = useState<string>(NEBULA_SRV.initial);

  useEffect(() => {
    // Non-blocking runtime lookup — refines the URL unless the user set an
    // explicit override in localStorage (refine() no-ops in that case).
    let cancelled = false;
    void NEBULA_SRV.refine().then((url) => {
      if (url && !cancelled) setNebulaSrv(url);
    });
    const check = () => {
      fetch(`${nebulaSrv}/api/cascade/subscriber-status`, {
        signal: AbortSignal.timeout(5000),
      })
        .then(r => r.json())
        .then((d: SubscriberStatusData) => { if (!cancelled) setStatus(d); })
        .catch(() => {
          // Endpoint unreachable — can't confirm liveness; show unknown
          // rather than a false "down" (nebula-srv itself may be restarting).
          if (!cancelled) setStatus(null);
        });
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [nebulaSrv]);

  const up = status?.up ?? null; // null → unknown (first load / API unreachable)

  const label = up === null ? 'Subscriber …' : up ? 'Subscriber up' : 'Subscriber DOWN';

  const tooltip =
    up === null
      ? 'Checking cascade interactive-turn subscriber…'
      : up
        ? `Cascade interactive-turn subscriber connected` +
          (status?.backendSince
            ? ` since ${new Date(status.backendSince).toLocaleString()}`
            : '') +
          (status?.backendPid ? ` (pid ${status.backendPid})` : '') +
          `.`
        : 'Cascade interactive-turn subscriber is DOWN — sent messages will hit the ' +
          'no-response timeout (90s leased / 30s harness). Check: systemctl --user ' +
          'status cascade-interactive-turn';

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border select-none',
        up === null && 'bg-gray-800/60 border-gray-700 text-gray-400',
        up === true && 'bg-emerald-500/10 border-emerald-700/40 text-emerald-300',
        up === false && 'bg-red-500/15 border-red-700/60 text-red-300 animate-pulse'
      )}
      title={tooltip}
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full',
          up === null && 'bg-gray-500',
          up === true && 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]',
          up === false && 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]'
        )}
      />
      <span className="font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}
