import React, { useEffect, useRef, useState } from 'react';
import { History, Plus, RefreshCw, Check } from 'lucide-react';
import { BackendService, SessionSummary } from '../services/AssemblyBackendService';
import { cn } from '../lib/utils';

/**
 * Session picker — browse past duality sessions (forum threads) and switch
 * to one, or start a fresh session. Fills the roadmap gap: previously the UI
 * could only resume the most recent watch or create a new thread, with no way
 * to reach older conversations.
 */
export function SessionPicker() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  /** True when the last load failed at the transport layer (not "no sessions"). */
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadSessions = async () => {
    setLoading(true);
    setError(false);
    setLoadFailed(false);
    try {
      const items = await BackendService.listSessions();
      setSessions(items);
      if (items.length === 0) setError(true);
    } catch (err) {
      console.error('[SessionPicker] Failed to list sessions:', err);
      setSessions([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && sessions === null) void loadSessions();
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Track the currently-loaded thread so the picker can mark it.
  useEffect(() => {
    const sub = BackendService.currentThreadId$.subscribe(setActiveId);
    return () => sub.unsubscribe();
  }, []);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const pick = (id: string) => {
    setOpen(false);
    setActiveId(id);
    void BackendService.loadThread(id);
  };

  const newSession = () => {
    setOpen(false);
    setActiveId(null);
    BackendService.startNewSession();
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={toggle}
        title="Session history — browse past duality conversations or start a new one"
        className={cn(
          'flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded border transition-colors',
          open
            ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
            : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:text-gray-200'
        )}
      >
        <History className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Sessions</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-gray-900 border border-gray-700 rounded-md shadow-xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-gray-500">Past sessions</span>
            <button
              onClick={() => void loadSessions()}
              title="Refresh"
              className="text-gray-500 hover:text-gray-300"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>
          </div>

          <button
            onClick={newSession}
            className="flex items-center space-x-2 px-3 py-2.5 text-sm text-emerald-400 hover:bg-emerald-500/10 border-b border-gray-800 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New session</span>
          </button>

          {loadFailed && (
            <p className="px-3 py-3 text-xs text-amber-400/90">
              Couldn't reach assembly-srv — check that it's running, then use the
              refresh button to retry.
            </p>
          )}
          {error && !loadFailed && sessions !== null && sessions.length === 0 && (
            <p className="px-3 py-3 text-xs text-gray-500">
              No past sessions found.
            </p>
          )}
          {loading && sessions === null && (
            <p className="px-3 py-3 text-xs text-gray-500">Loading sessions…</p>
          )}

          {sessions !== null &&
            sessions.map(s => (
              <button
                key={s.id}
                onClick={() => pick(s.id)}
                className={cn(
                  'flex items-start space-x-2 px-3 py-2 text-left hover:bg-gray-800 border-b border-gray-800/60 last:border-b-0',
                  activeId === s.id && 'bg-emerald-500/10'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 truncate">{s.title}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {formatDate(s.createdAt)}
                    {s.replyCount > 0 && ` · ${s.replyCount} replies`}
                    {s.lastReplyAt && ` · last ${formatDate(s.lastReplyAt)}`}
                  </p>
                </div>
                {activeId === s.id && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
