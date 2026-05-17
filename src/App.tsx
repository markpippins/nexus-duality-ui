import React from 'react';
import { TopBar } from './components/TopBar';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { ArchitectChat } from './components/ArchitectChat';
import { BuilderStream } from './components/BuilderStream';
import { FileTreeSidebar } from './components/FileTreeSidebar';
import { TerminalPanel } from './components/TerminalPanel';

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 font-sans overflow-hidden text-gray-100">
      <TopBar />
      
      <div className="flex-1 flex overflow-hidden">
        <WorkspaceSidebar />
        
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Main IDE Area */}
          <div className="flex-1 flex overflow-hidden">
            <ArchitectChat />
            <BuilderStream />
          </div>
          
          {/* Bottom Panel */}
          <TerminalPanel />
        </div>

        <FileTreeSidebar />
      </div>
    </div>
  );
}

