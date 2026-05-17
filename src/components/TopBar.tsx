import React, { useState } from 'react';
import { Settings, Cpu, HardDrive } from 'lucide-react';
import { AVAILABLE_PROVIDERS } from '../services/SimulatedBackendService';

export function TopBar() {
  const [archProvider, setArchProvider] = useState(AVAILABLE_PROVIDERS[0]);
  const [archModel, setArchModel] = useState(AVAILABLE_PROVIDERS[0].models[0]);
  
  const [buildProvider, setBuildProvider] = useState(AVAILABLE_PROVIDERS[1]);
  const [buildModel, setBuildModel] = useState(AVAILABLE_PROVIDERS[1].models[0]);

  return (
    <div className="h-14 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-4 text-sm text-gray-300">
      <div className="flex items-center space-x-2">
        <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white font-bold tracking-tighter">
          AC
        </div>
        <span className="font-semibold text-gray-100">AI Architect & Builder</span>
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

      <div>
        <Settings className="w-5 h-5 text-gray-400 hover:text-gray-200 cursor-pointer" />
      </div>
    </div>
  );
}
