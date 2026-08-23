/**
 * T25 3.2 (R-A-2026-08-15-008) — endpoint resolution for duality-ui.
 *
 * Resolution precedence (mirrors wind-ui 2.4, the ratified reference):
 *   localStorage (explicit user override) > runtime lookup (terrain
 *   /api/v1/lookup/{unit}) > $<UNIT>_TARGET env > legacy localhost literal.
 *
 * The env/legacy value is returned synchronously so callers always have a
 * URL; the lookup refines it once it returns (3s timeout, silent on failure).
 */

const LOOKUP_URL =
  (import.meta as any)?.env?.VITE_LOOKUP_URL || 'http://localhost:8084';

function readEnv(name: string): string | undefined {
  try {
    return (import.meta as any)?.env?.[`VITE_${name}`];
  } catch {
    return undefined;
  }
}

function localStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function resolveEndpoint(
  unit: string,
  envVar: string,
  legacyDefault: string,
): { initial: string; refine: () => Promise<string | null> } {
  const overrideKey = `nexus_${unit}_base_url`;
  const override = localStorageGet(overrideKey);
  const initial = override || readEnv(envVar) || legacyDefault;

  const refine = async (): Promise<string | null> => {
    if (localStorageGet(overrideKey)) {
      return null; // explicit user override wins; do not refine
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(`${LOOKUP_URL}/api/v1/lookup/${encodeURIComponent(unit)}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const d = await res.json();
      const eps = d.endpoints || [];
      const e = eps.find((x: any) => x.instance === d.preferred) || eps[0];
      if (!e || !e.port) return null;
      return `${e.scheme || 'http'}://${e.ip || e.host}:${e.port}`;
    } catch {
      return null; // lookup down -> env/legacy fallback stays
    } finally {
      clearTimeout(t);
    }
  };

  return { initial, refine };
}

/** nebula-srv (:3101) — env `VITE_NEBULA_SRV_TARGET`, refined by lookup. */
export const NEBULA_SRV = resolveEndpoint(
  'nebula-srv',
  'NEBULA_SRV_TARGET',
  'http://localhost:3101',
);
