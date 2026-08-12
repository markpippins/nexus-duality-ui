import React, { useState, useEffect } from 'react';
import { Cpu, HardDrive, ChevronRight, Zap } from 'lucide-react';
import { ExecutionBackend } from '../services/AssemblyBackendService';

interface BreadcrumbPart {
  label: string;
  icon: string;
  level: string;
}

interface TackleRole {
  id: string;
  name: string;
  description: string;
}

interface TopBarProps {
  breadcrumbs?: BreadcrumbPart[];
  leftRole: string;
  rightRole: string;
  executionBackend: ExecutionBackend;
  onLeftRoleChange: (role: string) => void;
  onRightRoleChange: (role: string) => void;
  onExecutionBackendChange: (backend: ExecutionBackend) => void;
}

const TACKLE_SRV = 'http://localhost:3410';
const ROLES_URL = `${TACKLE_SRV}/roles`;

export function TopBar({
  breadcrumbs = [],
  leftRole,
  rightRole,
  executionBackend,
  onLeftRoleChange,
  onRightRoleChange,
  onExecutionBackendChange,
}: TopBarProps) {
  const [roles, setRoles] = useState<TackleRole[]>([]);

  useEffect(() => {
    fetch(ROLES_URL)
      .then(r => r.json())
      .then(data => {
        const list: TackleRole[] = data.roles || [];
        setRoles(list);
        // Auto-select architect/builder if they exist and not already set
        const arch = list.find(r => r.name === 'architect');
        const build = list.find(r => r.name === 'builder');
        if (arch && !leftRole) onLeftRoleChange(arch.name);
        if (build && !rightRole) onRightRoleChange(build.name);
      })
      .catch(() => {
        // Fallback: tackle-srv may not be running; keep defaults
      });
  }, []);

  // Select values are role NAMES (not the tackle.roles UUID id): the whole
  // backend — tackle.config_bundle, role_leases, harness-srv, and the turn
  // subscriber — keys on the role name. Using r.id here made harness runs
  // fail with 'no active config_bundle found for <uuid>'. Display names are
  // therefore just the values themselves with a fallback.
  const leftRoleName = leftRole || 'architect';
  const rightRoleName = rightRole || 'builder';

  return (
    <div className="h-14 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-4 text-sm text-gray-300 shrink-0">
      <div className="flex items-center space-x-2">
        <div className="w-7 h-7 rounded-md bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v.75c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-.75z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest select-none">Duality</span>

        {/* Addressbar Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <div className="flex items-center ml-4 pl-4 border-l border-gray-700">
            {breadcrumbs.map((part, i) => (
              <React.Fragment key={`${part.level}-${part.label}`}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-gray-600 mx-1" />}
                <span className={`text-sm px-1.5 py-0.5 rounded ${
                  part.level === 'system' ? 'bg-blue-900/30 text-blue-300' :
                  part.level === 'subsystem' ? 'bg-purple-900/30 text-purple-300' :
                  'bg-emerald-900/30 text-emerald-300'
                }`}>
                  {part.label}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center space-x-6">
        {/* Left Panel Agent Role Selector */}
        <div className="flex items-center space-x-2 bg-gray-800 px-3 py-1.5 rounded-md border border-gray-700">
          <Cpu className="w-4 h-4 text-blue-400" />
          <span className="text-gray-400 text-sm uppercase tracking-wider">Left Panel</span>
          <select
            className="bg-transparent text-gray-200 outline-none cursor-pointer"
            value={leftRole}
            onChange={(e) => onLeftRoleChange(e.target.value)}
            title={leftRoleName + ' — agent in left chat panel'}
          >
            {roles.length === 0 && (
              <option value={leftRole}>{leftRoleName}</option>
            )}
            {roles.map(r => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
          <span className="text-[10px] text-gray-500 font-mono uppercase px-1.5 py-0.5 rounded bg-gray-700/50">
            {leftRoleName}
          </span>
        </div>

        {/* Right Panel Agent Role Selector */}
        <div className="flex items-center space-x-2 bg-gray-800 px-3 py-1.5 rounded-md border border-gray-700">
          <HardDrive className="w-4 h-4 text-green-400" />
          <span className="text-gray-400 text-sm uppercase tracking-wider">Right Panel</span>
          <select
            className="bg-transparent text-gray-200 outline-none cursor-pointer"
            value={rightRole}
            onChange={(e) => onRightRoleChange(e.target.value)}
            title={rightRoleName + ' — agent in right stream panel'}
          >
            {roles.length === 0 && (
              <option value={rightRole}>{rightRoleName}</option>
            )}
            {roles.map(r => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
          <span className="text-[10px] text-gray-500 font-mono uppercase px-1.5 py-0.5 rounded bg-gray-700/50">
            {rightRoleName}
          </span>
        </div>

        {/* Execution Backend Selector — applies to NEW sessions */}
        <div
          className="flex items-center space-x-2"
          title={
            'Execution backend for new sessions: Freebuff = interactive turn ' +
            '(session owns context); Harness = ephemeral opencode run via harness-srv'
          }
        >
          <Zap className="w-4 h-4 text-amber-400" />
          <div className="flex bg-gray-800 rounded-md border border-gray-700 p-0.5">
            {(['freebuff', 'harness'] as const).map(b => (
              <button
                key={b}
                onClick={() => onExecutionBackendChange(b)}
                className={
                  'px-2.5 py-1 text-xs font-medium rounded transition-colors ' +
                  (executionBackend === b
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200')
                }
              >
                {b === 'freebuff' ? 'Freebuff' : 'Harness'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
