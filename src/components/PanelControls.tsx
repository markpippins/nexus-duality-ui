import React from 'react';
import { Cpu, Zap } from 'lucide-react';
import { ExecutionBackend } from '../services/AssemblyBackendService';

export interface TackleRole {
  id: string;
  name: string;
  description: string;
}

interface PanelControlsProps {
  /** Panel suffix for the title, e.g. "Chat" or "Stream". */
  title: string;
  role: string;
  roles: TackleRole[];
  executionBackend: ExecutionBackend;
  onRoleChange: (role: string) => void;
  onExecutionBackendChange: (backend: ExecutionBackend) => void;
}

/**
 * Per-panel control bar: the agent role selector + the leased/harness
 * execution switch for ONE panel. Rendered above the panel it controls —
 * each panel (left chat, right stream) has its own, so the two agents can
 * run in different modes.
 *
 * Leased = interactive polling-loop agent (needs an ACTIVE role lease);
 * Harness = cloud executor (opencode/codex/gemini launched with a prompt).
 */
export function PanelControls({
  title,
  role,
  roles,
  executionBackend,
  onRoleChange,
  onExecutionBackendChange,
}: PanelControlsProps) {
  const roleName = role || (roles.length > 0 ? roles[0].name : 'agent');
  const roleDisplayName = roleName.charAt(0).toUpperCase() + roleName.slice(1);

  return (
    <div className="h-10 border-b border-gray-800 flex items-center gap-3 px-3 shrink-0 bg-gray-900/90 z-10">
      {/* Role selector */}
      <div
        className="flex items-center gap-1.5 bg-gray-800 px-2 py-1 rounded-md border border-gray-700"
        title="Agent role — select values are role NAMES (tackle.roles); the backend, role leases, harness-srv and the turn subscriber all key on the role name"
      >
        <Cpu className="w-3.5 h-3.5 text-blue-400" />
        <select
          className="bg-transparent text-gray-200 text-xs outline-none cursor-pointer"
          value={role}
          onChange={(e) => onRoleChange(e.target.value)}
          aria-label="Agent role"
        >
          {(roles.length === 0 || !roles.some(r => r.name === role)) && (
            <option value={role}>{roleName}</option>
          )}
          {roles.map(r => (
            <option key={r.id} value={r.name}>{r.name}</option>
          ))}
        </select>
      </div>

      {/* Execution mode switch — leased vs harness, applies to NEW sessions */}
      <div
        className="flex items-center gap-1.5"
        title={
          'Execution mode for this panel: Leased = interactive polling-loop agent ' +
          '(requires an ACTIVE role lease — the agent must have acquired one and be ' +
          'listening); Harness = cloud executor (opencode/codex/gemini launched with ' +
          'a prompt, no lease needed)'
        }
      >
        <Zap className="w-3.5 h-3.5 text-amber-400" />
        <div className="flex bg-gray-800 rounded-md border border-gray-700 p-0.5">
          {(['harness', 'freebuff'] as const).map(b => (
            <button
              key={b}
              onClick={() => onExecutionBackendChange(b)}
              className={
                'px-2 py-0.5 text-[11px] font-medium rounded transition-colors ' +
                (executionBackend === b
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-200')
              }
            >
              {b === 'freebuff' ? 'Leased' : 'Harness'}
            </button>
          ))}
        </div>
      </div>

      <span className="text-sm font-semibold text-gray-400 uppercase tracking-wider ml-auto">
        {roleDisplayName} {title}
      </span>
    </div>
  );
}
