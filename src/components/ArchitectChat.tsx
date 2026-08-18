import React, { useState, useRef, useEffect } from 'react';
import { useSimulation } from '../hooks/useSimulation';
import { Send, User, Cpu, AlertTriangle, Info, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { ExecutionBackend, TurnState } from '../services/AssemblyBackendService';
import { PanelControls, TackleRole } from './PanelControls';

interface ArchitectChatProps {
  role: string;
  roles: TackleRole[];
  rightRole?: string;
  executionBackend?: ExecutionBackend;
  onRoleChange: (role: string) => void;
  onExecutionBackendChange: (backend: ExecutionBackend) => void;
}

const NEBULA_SRV = 'http://localhost:3101';

/** Raw tackle.role_leases row as served by GET /api/role-leases. */
interface RoleLeaseRow {
  id?: string;
  role?: string;
  status: string;
  budget_units: number | null;
  consumed_units: number;
  expires_at: string | null;
  window_end: string | null;
}

type LeaseWarning =
  | { kind: 'none' }                                      // engineer — Freebuff-hosted, no warning
  | { kind: 'loading' }
  | { kind: 'unavailable' }                               // nebula-srv unreachable
  | { kind: 'no-lease' }                                  // R1: "No active role lease"
  | { kind: 'expired'; at: Date | null }                  // R1: "Role lease expired at …"
  | { kind: 'exhausted'; consumed: number; budget: number } // R1: "… exhausted (X/Y units consumed)"
  | { kind: 'ok'; remaining: number | null; windowEnd: Date | null };

/**
 * Mirror the cascade coordinator's R1 lease governance (hard stop) so the
 * UI shows the exact reason the first turn will fail, before the user sends:
 *  - no ACTIVE row              → "No active role lease"
 *  - expires_at/window_end past → "Role lease expired at <iso>"
 *  - budget consumed            → "Role lease exhausted (X/Y units consumed)"
 *  - otherwise                  → lease healthy (rate limits can still bite)
 */
function evaluateRoleLease(items: RoleLeaseRow[]): LeaseWarning {
  const lease = items.find(l => l.status === 'ACTIVE');
  if (!lease) return { kind: 'no-lease' };
  const expiryStr = lease.expires_at ?? lease.window_end;
  const expiry = expiryStr ? new Date(expiryStr) : null;
  if (expiry && expiry.getTime() < Date.now()) return { kind: 'expired', at: expiry };
  const budget = lease.budget_units;
  const consumed = lease.consumed_units ?? 0;
  if (budget !== null && budget !== undefined && consumed >= budget) {
    return { kind: 'exhausted', consumed, budget };
  }
  return {
    kind: 'ok',
    remaining: budget !== null && budget !== undefined ? Math.max(0, budget - consumed) : null,
    windowEnd: expiry,
  };
}

export function ArchitectChat({
  role,
  roles,
  rightRole = 'builder',
  executionBackend = 'freebuff',
  onRoleChange,
  onExecutionBackendChange,
}: ArchitectChatProps) {
  const { architectChat, BackendService } = useSimulation();
  const [input, setInput] = useState('');
  const [agentWorking, setAgentWorking] = useState(false);
  const [turnState, setTurnState] = useState<TurnState | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // In-flight turn indicator — the roadmap's isStreaming flag was never set
  // in real mode; this drives the same blinking cursor while a turn is
  // awaiting its agent reply (no fabricated tokens — the cursor simply marks
  // that the agent is working).
  useEffect(() => {
    const sub = BackendService.agentWorking$.subscribe(setAgentWorking);
    return () => sub.unsubscribe();
  }, [BackendService]);

  // Server-side turn envelope (P0-1 item 3) — the authoritative lifecycle.
  // Rendered as a status line under the working cursor when a turn is in
  // flight, and as the failure detail when a turn failed/timed out.
  useEffect(() => {
    const sub = BackendService.turnState$.subscribe(setTurnState);
    return () => sub.unsubscribe();
  }, [BackendService]);

  // Configure roles + execution backend and load the session. Re-runs on
  // mount, on role switch (new role → new thread), and on backend switch
  // (new backend → fresh session with the selected execution path).
  useEffect(() => {
    BackendService.setExecutionBackend(executionBackend);
    BackendService.setRoles(role, rightRole);
    BackendService.ensureThread().catch(() => {});
  }, [role, rightRole, executionBackend]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [architectChat, agentWorking]);

  // ── Pre-send role-lease warning (non-engineer roles) ───────────────
  // Non-engineer roles run on the z-ai/glm-5.2 lease model via the
  // cascade interactive-turn subscriber. If there is no ACTIVE
  // tackle.role_leases entry (or it is expired/exhausted), the cascade
  // coordinator's R1 hard stop closes the session on the first turn with
  // an exact reason. Mirror that logic here so the user knows the exact
  // failure reason BEFORE sending.
  const [leaseWarning, setLeaseWarning] = useState<LeaseWarning>({ kind: 'none' });

  useEffect(() => {
    // engineer is the Freebuff-hosted role — runs in this interactive
    // session without the z-ai/glm-5.2 lease path.
    if (role === 'engineer') {
      setLeaseWarning({ kind: 'none' });
      return;
    }
    let cancelled = false;
    setLeaseWarning({ kind: 'loading' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    fetch(`${NEBULA_SRV}/api/role-leases?role=${encodeURIComponent(role)}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((data: { items?: RoleLeaseRow[] }) => {
        if (cancelled) return;
        setLeaseWarning(evaluateRoleLease(data.items ?? []));
      })
      .catch(() => { if (!cancelled) setLeaseWarning({ kind: 'unavailable' }); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; ctrl.abort(); clearTimeout(timer); };
  }, [role]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    BackendService.sendUserMessage(input.trim());
    setInput('');
  };

  const roleDisplayName = role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <div className="flex-1 flex flex-col border-r border-gray-800 bg-gray-900 h-full relative">
      {/* Header — role selector + leased/harness switch above the left panel */}
      <PanelControls
        title="Chat"
        role={role}
        roles={roles}
        executionBackend={executionBackend}
        onRoleChange={onRoleChange}
        onExecutionBackendChange={onExecutionBackendChange}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <AnimatePresence initial={false}>
          {architectChat.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex space-x-3 max-w-[90%]",
                msg.role === 'user' ? "ml-auto flex-row-reverse space-x-reverse" : "mr-auto"
              )}
            >
              {msg.role === 'thinking' ? (
                <ThinkingTrace content={msg.content} />
              ) : (
                <>
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
                    msg.role === 'user' ? "bg-blue-600" : msg.role === 'system' ? "bg-amber-600" : "bg-purple-600"
                  )}>
                    {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : msg.role === 'system' ? <AlertTriangle className="w-4 h-4 text-white" /> : <Cpu className="w-4 h-4 text-white" />}
                  </div>

                  <div className={cn(
                    "rounded-lg p-3 text-sm",
                    msg.role === 'user' ? "bg-blue-600/20 text-blue-50" : msg.role === 'system' ? "bg-amber-950/60 border border-amber-700/60 text-amber-200" : "bg-gray-800 text-gray-200 border border-gray-700"
                  )}>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    {msg.isStreaming && <span className="inline-block w-2 h-4 bg-gray-400 ml-1 animate-pulse align-middle" />}
                  </div>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Agent is working — streaming cursor (in-flight turn indicator) */}
        {agentWorking && (
          <div className="flex items-center space-x-2 text-xs text-gray-500 animate-pulse">
            <span className="inline-block w-2 h-4 bg-emerald-400" />
            <span>{roleDisplayName} is working…</span>
            {turnState && (turnState.state === 'accepted' || turnState.state === 'running') && (
              <span className="text-[10px] uppercase tracking-widest text-gray-600">
                {turnState.state === 'accepted' ? 'queued' : 'running'}
                {turnState.job_id ? ` · job ${turnState.job_id.slice(0, 8)}` : ''}
              </span>
            )}
          </div>
        )}

        {/* Terminal turn failure — server-side envelope detail (P0-1 item 3) */}
        {!agentWorking && turnState && (turnState.state === 'failed' || turnState.state === 'timed_out' || turnState.state === 'cancelled') && (
          <div className="flex items-start space-x-2 text-xs text-amber-400/90 border border-amber-700/40 bg-amber-950/30 rounded-md px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold uppercase tracking-widest text-[10px]">
                Turn {turnState.state.replace('_', ' ')}
                {turnState.job_id ? ` · job ${turnState.job_id.slice(0, 8)}` : ''}
              </p>
              {turnState.failure_detail && (
                <p className="whitespace-pre-wrap leading-relaxed mt-0.5">{turnState.failure_detail}</p>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Pre-send warning — exact failure reason for leased (interactive)
          roles without an ACTIVE role lease. Only relevant in Leased mode;
          the Harness (cloud executor) path needs no lease. */}
      {executionBackend === 'freebuff' && leaseWarning.kind !== 'none' && leaseWarning.kind !== 'loading' && (
        <LeaseWarningBanner warning={leaseWarning} role={role} />
      )}

      {/* Input */}
      <div className="p-4 shrink-0 bg-gray-900">
        <form onSubmit={handleSend} className="relative flex items-center">
          <input
            type="text"
            className="w-full bg-gray-800 border border-gray-700 rounded-md py-2.5 pl-4 pr-12 text-sm text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-500"
            placeholder={`Message ${roleDisplayName}...`}
            value={input}
            onChange={e => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="absolute right-2 p-1.5 rounded bg-blue-600 text-white disabled:bg-gray-700 disabled:text-gray-400 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Collapsible "agent thinking" trace — the reasoning the harness agent
 * produced before its answer (posted by the subscriber as a role=thinking
 * comment). Rendered Freebuff-style: a muted header, collapsed by default.
 */
function ThinkingTrace({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center space-x-2 text-[11px] text-gray-500 hover:text-gray-300 transition-colors select-none"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <Brain className="w-3.5 h-3.5" />
        <span className="uppercase tracking-widest">Thinking</span>
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-gray-700 pl-3 py-0.5 text-xs text-gray-500 italic whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

/**
 * Pre-send warning: a leased (interactive) role without an ACTIVE role
 * lease will fail the first turn (cascade R1 hard stop) — surfaced before
 * the user sends. Only rendered in Leased mode; the Harness (cloud
 * executor) path needs no lease.
 */
function LeaseWarningBanner({
  warning,
  role,
}: {
  warning: LeaseWarning;
  role: string;
}) {
  const roleName = role.charAt(0).toUpperCase() + role.slice(1);
  const failure =
    warning.kind === 'no-lease' ||
    warning.kind === 'expired' ||
    warning.kind === 'exhausted' ||
    warning.kind === 'unavailable';

  // The leased (interactive) path hard-stops on a bad lease — the exact
  // reason string the run will hit (mirrors cascade R1).
  const leaseConsequence = (exactReason: string) =>
    `The Leased (interactive) path will fail the first turn with exactly ${exactReason} (R1 hard stop).`;

  let title = '';
  let body = '';
  switch (warning.kind) {
    case 'no-lease':
      title = `${roleName} has no active role lease`;
      body = leaseConsequence('“No active role lease”') +
        ' Leased roles only run when an agent has acquired an ACTIVE role lease and ' +
        'is in a polling loop — issue a lease (POST /api/role-leases/issue on ' +
        'nebula-srv :3101) or switch this panel to Harness (cloud executor).';
      break;
    case 'expired':
      title = `${roleName}'s role lease is expired`;
      body = leaseConsequence(
        `“Role lease expired at ${warning.at ? warning.at.toLocaleString() : '<time>'}”`
      ) + ' Renew the lease (POST /api/role-leases/:id/renew) or switch roles.';
      break;
    case 'exhausted':
      title = `${roleName}'s role lease is exhausted`;
      body = leaseConsequence(
        `“Role lease exhausted (${warning.consumed}/${warning.budget} units consumed)”`
      ) + ' Renew the lease or switch roles.';
      break;
    case 'unavailable':
      title = `Couldn't check ${roleName}'s role lease`;
      body = 'nebula-srv (:3101) is unreachable, so the lease state is unknown. If the lease ' +
        'is missing or expired, the session fails with a lease error instead of a response.';
      break;
    case 'ok':
      title = `${roleName} lease active`;
      body = `${warning.remaining !== null ? warning.remaining + ' units remaining, ' : ''}` +
        `window until ${warning.windowEnd ? warning.windowEnd.toLocaleString() : 'now'}. ` +
        'This role still runs on z-ai/glm-5.2 — upstream rate limits (HTTP 429) can fail a ' +
        'run; the exact reason will surface in the chat.';
      break;
    default:
      return null;
  }

  return (
    <div className="px-4 pt-3 shrink-0">
      <div
        className={cn(
          'flex items-start space-x-2.5 rounded-md border px-3 py-2.5 text-xs leading-relaxed',
          failure
            ? 'bg-amber-950/50 border-amber-700/60 text-amber-200'
            : 'bg-blue-950/40 border-blue-800/60 text-blue-200'
        )}
      >
        {failure
          ? <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          : <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />}
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 opacity-90">{body}</p>
        </div>
      </div>
    </div>
  );
}
