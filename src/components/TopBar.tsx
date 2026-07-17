import React, { useState } from 'react';
import { Cpu, HardDrive, ChevronRight } from 'lucide-react';
import { AVAILABLE_PROVIDERS } from '../services/SimulatedBackendService';

interface BreadcrumbPart {
  label: string;
  icon: string;
  level: string;
}

interface TopBarProps {
  breadcrumbs?: BreadcrumbPart[];
}

export function TopBar({ breadcrumbs = [] }: TopBarProps) {
  const [archProvider, setArchProvider] = useState(AVAILABLE_PROVIDERS[0]);
  const [archModel, setArchModel] = useState(AVAILABLE_PROVIDERS[0].models[0]);
  
  const [buildProvider, setBuildProvider] = useState(AVAILABLE_PROVIDERS[1]);
  const [buildModel, setBuildModel] = useState(AVAILABLE_PROVIDERS[1].models[0]);

  return (
    <div className="h-14 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-4 text-sm text-gray-300">
      <div className="flex items-center space-x-2">
        <div className="w-7 h-7 rounded-md bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v.75c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-.75z" />
          </svg>
        </div>
        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest select-none">Duality</span>

        {/* Addressbar Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <div className="flex items-center ml-4 pl-4 border-l border-gray-700">
            {breadcrumbs.map((part, i) => (
              <React.Fragment key={`${part.level}-${part.label}`}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-gray-600 mx-1" />}
                <span className={`text-xs px-1.5 py-0.5 rounded ${
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
        {/* Architect Selector */}
        <div className="flex items-center space-x-2 bg-gray-800 px-3 py-1.5 rounded-md border border-gray-700">
          <Cpu className="w-4 h-4 text-blue-400" />
          <span className="text-gray-400 text-xs uppercase tracking-wider">Architect</span>
          <select 
            className="bg-transparent text-gray-200 outline-none cursor-pointer"
            value={archProvider.id}
            onChange={(e) => {
              const p = AVAILABLE_PROVIDERS.find(x => x.id === e.target.value)!;
              setArchProvider(p);
              setArchModel(p.models[0]);
            }}
          >
            {AVAILABLE_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="text-gray-600">/</span>
          <select 
            className="bg-transparent text-gray-200 outline-none cursor-pointer"
            value={archModel}
            onChange={(e) => setArchModel(e.target.value)}
          >
            {archProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Builder Selector */}
        <div className="flex items-center space-x-2 bg-gray-800 px-3 py-1.5 rounded-md border border-gray-700">
          <HardDrive className="w-4 h-4 text-green-400" />
          <span className="text-gray-400 text-xs uppercase tracking-wider">Builder</span>
          <select 
            className="bg-transparent text-gray-200 outline-none cursor-pointer"
            value={buildProvider.id}
            onChange={(e) => {
              const p = AVAILABLE_PROVIDERS.find(x => x.id === e.target.value)!;
              setBuildProvider(p);
              setBuildModel(p.models[0]);
            }}
          >
            {AVAILABLE_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="text-gray-600">/</span>
          <select 
            className="bg-transparent text-gray-200 outline-none cursor-pointer"
            value={buildModel}
            onChange={(e) => setBuildModel(e.target.value)}
          >
            {buildProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
