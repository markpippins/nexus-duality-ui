import React, { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { ArchitectChat } from './components/ArchitectChat';
import { BuilderStream } from './components/BuilderStream';
import { FileTreeSidebar } from './components/FileTreeSidebar';
import { TerminalPanel } from './components/TerminalPanel';
import { ThemeToggle } from '@shared/components/ThemeToggle';

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
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPart[]>([]);

  // Apply the initial theme on mount (before SSE delivers the first event)
  applyTheme(getInitialTheme());

  // Connect to the UI event bus and subscribe to theme changes + location changes
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
        if (event.eventName === 'location-change') {
          console.log('[duality-ui] received location change:', event.eventValue);
          const parts = Array.isArray(event.eventValue) ? event.eventValue : [];
          setBreadcrumbs(parts);
        }
      } catch {}
    };
    // EventSource auto-reconnects on error; just log for debugging
    es.onerror = () => { console.warn('[duality-ui] EventSource connection error, will auto-reconnect'); };
    return () => es.close();
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 font-sans overflow-hidden text-gray-100">
      <ThemeToggle storageKey="duality-theme" />
      <TopBar breadcrumbs={breadcrumbs} />
      
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
