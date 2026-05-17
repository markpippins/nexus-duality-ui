import React, { useRef, useEffect } from 'react';
import { useSimulation } from '../hooks/useSimulation';
import { Activity, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export function BuilderStream() {
  const { builderLogs } = useSimulation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [builderLogs]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'pending': return <Clock className="w-4 h-4 text-blue-400 rotate-animation" />;
      default: return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col border-r border-gray-800 bg-[#0d1117] h-full relative font-mono">
      {/* Header */}
      <div className="h-10 border-b border-gray-800 flex items-center px-4 shrink-0 bg-gray-900/90 z-10">
        <span className="text-xs font-bold text-gray-400 tracking-widest uppercase">Builder Stream</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
        {builderLogs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 space-y-3">
            <Activity className="w-8 h-8 opacity-20" />
            <p className="uppercase tracking-widest text-[10px]">Awaiting Instructions</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {builderLogs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-col bg-gray-900 border border-gray-800 p-3 rounded-md"
            >
              <div className="flex items-center space-x-2 mb-1">
                <span className={cn(
                  "font-bold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded",
                  log.agent === 'architect' ? "bg-purple-900/50 text-purple-400" : "bg-green-900/50 text-green-400"
                )}>
                  {log.agent}
                </span>
                <span className="text-gray-500 text-[10px]">{log.timestamp.toLocaleTimeString()}</span>
              </div>
              <div className="flex items-start space-x-2 mt-1">
                <div className="mt-0.5">
                  {getStatusIcon(log.status)}
                </div>
                <span className="text-gray-300 leading-relaxed">{log.details}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} className="h-4" />
      </div>

      <style>{`
        .rotate-animation {
          animation: spin 2s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
