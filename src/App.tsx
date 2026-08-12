import React, { useEffect, useState } from 'react';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { ArchitectChat } from './components/ArchitectChat';
import { BuilderStream } from './components/BuilderStream';
import { FileTreeSidebar } from './components/FileTreeSidebar';
import { TopBar } from './components/TopBar';
import { ExecutionBackend } from './services/AssemblyBackendService';
const EVENT_BUS_URL = 'http://localhost:3200';

export interface BreadcrumbPart {
  label: string;
  icon: string;
  level: string;
}

/** Read the current theme from the nexus-console parent frame (sets classes on document.body). */
function getInitialTheme(): string {
  try {
    const parentBody = window.parent.document.body;
    if (parentBody.classList.contains('theme-light')) return 'theme-light';
    if (parentBody.classList.contains('theme-steel')) return 'theme-steel';
    if (parentBody.classList.contains('theme-dark')) return 'theme-dark';
  } catch {
    // Cross-origin or no parent — fall through to default
  }
  return 'theme-steel';
}

function applyTheme(themeValue: unknown) {
  const theme = String(themeValue ?? 'theme-steel');
  const isDark = theme === 'theme-dark' || theme === 'theme-steel';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('theme-dark', theme === 'theme-dark');
  document.documentElement.classList.toggle('theme-steel', theme === 'theme-steel');
  document.documentElement.classList.toggle('theme-light', theme === 'theme-light');
  document.documentElement.setAttribute('data-theme', theme);
}

export default function App() {
  // Apply the initial theme on mount (before SSE delivers the first event)
  applyTheme(getInitialTheme());

  // Role state — lifted from TopBar so ArchitectChat and BuilderStream can use it
  const [leftRole, setLeftRole] = useState<string>('analyst');
  const [rightRole, setRightRole] = useState<string>('builder');

  // Execution backend — applies to NEW sessions (freebuff interactive vs
  // harness-srv opencode). ArchitectChat reacts to changes by re-ensuring the
  // thread, creating a fresh session with the selected backend.
  const [executionBackend, setExecutionBackend] = useState<ExecutionBackend>('freebuff');

  // Connect to the UI event bus and subscribe to theme changes
  useEffect(() => {
    const es = new EventSource(`${EVENT_BUS_URL}/api/events/stream?sender=duality-ui`);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        if (event.sender === '_system') return;
        if (event.eventName === 'theme-change') {
          console.log('[duality-ui] received theme change:', event.eventValue);
          applyTheme(event.eventValue);
        }
      } catch {}
    };
    // EventSource auto-reconnects on error; just log for debugging
    es.onerror = () => { console.warn('[duality-ui] EventSource connection error, will auto-reconnect'); };
    return () => es.close();
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 font-sans overflow-hidden text-gray-100">
      <TopBar
        leftRole={leftRole}
        rightRole={rightRole}
        executionBackend={executionBackend}
        onLeftRoleChange={setLeftRole}
        onRightRoleChange={setRightRole}
        onExecutionBackendChange={setExecutionBackend}
      />
      <div className="flex-1 flex overflow-hidden">
        <WorkspaceSidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Main IDE Area */}
          <div className="flex-1 flex overflow-hidden">
            <ArchitectChat role={leftRole} executionBackend={executionBackend} />
            <BuilderStream role={rightRole} />
          </div>

        </div>

        <FileTreeSidebar />
      </div>
    </div>
  );
}
