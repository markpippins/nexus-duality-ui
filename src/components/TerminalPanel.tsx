import React, { useRef, useEffect } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { BackendService } from '../services/SimulatedBackendService';
import { TerminalSquare } from 'lucide-react';

export function TerminalPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    let unmounted = false;
    const term = new Terminal({
      theme: {
        background: '#111827',
        foreground: '#F3F4F6',
        cursor: '#3B82F6',
        selectionBackground: '#374151',
      },
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    let resizeObserver: ResizeObserver | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;

    term.writeln('\x1b[1;34mOpenCode Architecture Shell\x1b[0m v1.0.0');
    term.write('$ ');

    const sub = BackendService.terminalOutput$.subscribe(text => {
      if (!unmounted) {
        term.write(text);
      }
    });

    const tryFit = () => {
      if (unmounted || !terminalRef.current) return;
      try {
        if (terminalRef.current.clientWidth > 0 && terminalRef.current.clientHeight > 0) {
          fitAddon.fit();
        }
      } catch (e) {
        // Ignore fit errors if xterm core isn't completely ready
      }
    };

    // Open terminal safely after a short delay to allow DOM to settle
    fallbackTimer = setTimeout(() => {
      if (unmounted || !terminalRef.current) return;
      
      try {
        term.open(terminalRef.current);
        tryFit();
      } catch (err) {
        console.warn('Error opening terminal:', err);
      }

      resizeObserver = new ResizeObserver(() => {
        if (unmounted) return;
        // Use requestAnimationFrame for debounced resize
        requestAnimationFrame(() => {
          tryFit();
        });
      });
      resizeObserver.observe(terminalRef.current);
    }, 50);

    return () => {
      unmounted = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (resizeObserver) resizeObserver.disconnect();
      sub.unsubscribe();
      try {
        term.dispose();
      } catch (e) {}
    };
  }, []);

  return (
    <div className="h-64 border-t border-gray-800 bg-gray-900 flex flex-col w-full">
      <div className="flex items-center px-4 py-1.5 border-b border-gray-800 bg-gray-900/80">
        <TerminalSquare className="w-4 h-4 text-gray-400 mr-2" />
        <span className="text-xs text-gray-400 font-medium tracking-wide uppercase">Terminal (Simulated)</span>
      </div>
      <div className="flex-1 p-2 overflow-hidden" ref={terminalRef}></div>
    </div>
  );
}
