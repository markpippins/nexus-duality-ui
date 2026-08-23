import React, { useState } from 'react';
import { useSimulation } from '../hooks/useSimulation';
import { File, Folder, ChevronRight, ChevronDown, ChevronLeft, AlignLeft } from 'lucide-react';
import { FileNode } from '../types';
import { cn } from '../lib/utils';

function TreeNode({ node, depth = 0 }: { node: FileNode, depth?: number }) {
  const [isOpen, setIsOpen] = useState(node.isOpen !== false);
  const isFolder = node.type === 'folder';

  return (
    <div className="select-none">
      <div 
        className="flex items-center space-x-1.5 py-1 px-2 hover:bg-gray-800/50 cursor-pointer rounded-sm text-sm"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => isFolder && setIsOpen(!isOpen)}
      >
        {isFolder ? (
          isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        ) : (
          <span className="w-3.5 h-3.5 shrink-0" /> // spacer
        )}
        
        {isFolder ? (
          <Folder className="w-4 h-4 text-blue-400 shrink-0" />
        ) : (
          <File className="w-4 h-4 text-gray-400 shrink-0" />
        )}
        
        <span className={cn(
          "truncate",
          isFolder ? "text-gray-300" : "text-gray-400 hover:text-gray-200"
        )}>
          {node.name}
        </span>
      </div>

      {isFolder && isOpen && node.children && (
        <div>
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTreeSidebar() {
  const { fileTree, fileTreeError, isLiveFileMode } = useSimulation();
  const [collapsed, setCollapsed] = useState(true);

  if (collapsed) {
    return (
      <div className="w-12 h-full border-l border-gray-800 bg-gray-900/50 flex flex-col items-center py-4 cursor-pointer" onClick={() => setCollapsed(false)}>
        <ChevronLeft className="w-5 h-5 text-gray-400 mb-4" />
        <AlignLeft className="w-5 h-5 text-gray-500" />
      </div>
    );
  }

  return (
    <div className="w-64 h-full border-l border-gray-800 bg-gray-900/50 flex flex-col">
      <div className="flex items-center px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/20 cursor-pointer" onClick={() => setCollapsed(true)}>
        <AlignLeft className="w-4 h-4 text-gray-500 mr-2" />
        <span className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Explorer</span>
        {/* Distinct connection label: live file-system-server vs mock */}
        <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${
          isLiveFileMode
            ? 'bg-green-950/60 text-green-300 border-green-800/60'
            : 'bg-purple-950/60 text-purple-300 border-purple-800/60'
        }`}>
          {isLiveFileMode ? 'LIVE fs' : 'MOCK'}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-500 ml-auto" />
      </div>
      {fileTreeError && (
        <div className="px-3 py-2 text-[10px] font-mono text-rose-300 bg-rose-950/30 border-b border-rose-900/40">
          ⚠ {fileTreeError}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2">
        {fileTree.length === 0 && !fileTreeError ? (
          <div className="px-2 py-1 text-[10px] text-gray-500 font-mono">
            {isLiveFileMode ? 'Loading live file tree…' : 'No files (mock)'}
          </div>
        ) : (
          fileTree.map(node => (
            <TreeNode key={node.id} node={node} />
          ))
        )}
      </div>
    </div>
  );
}
