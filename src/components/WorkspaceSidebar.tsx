import React, { useState } from 'react';
import { useSimulation } from '../hooks/useSimulation';
import { FolderKanban, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

export function WorkspaceSidebar() {
  const { workspaces, activeWorkspace, BackendService } = useSimulation();
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="w-12 h-full border-r border-gray-800 bg-gray-900/50 flex flex-col items-center py-4 cursor-pointer" onClick={() => setCollapsed(false)}>
        <ChevronRight className="w-5 h-5 text-gray-400 mb-4" />
        <FolderKanban className="w-5 h-5 text-gray-500" />
      </div>
    );
  }

  return (
    <div className="w-64 h-full border-r border-gray-800 bg-gray-900/50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/20 cursor-pointer" onClick={() => setCollapsed(true)}>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Workspaces</span>
        <ChevronDown className="w-4 h-4 text-gray-500" />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {workspaces.map(ws => (
          <div 
            key={ws.id}
            onClick={() => BackendService.setActiveWorkspace(ws)}
            className={cn(
              "px-3 py-2 rounded-md cursor-pointer flex items-center space-x-2 transition-colors",
              activeWorkspace?.id === ws.id 
                ? "bg-blue-500/10 text-blue-400" 
                : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
            )}
          >
            <FolderKanban className="w-4 h-4" />
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm truncate">{ws.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
