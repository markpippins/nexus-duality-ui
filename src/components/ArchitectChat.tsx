import React, { useState, useRef, useEffect } from 'react';
import { useSimulation } from '../hooks/useSimulation';
import { Send, User, Cpu } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export function ArchitectChat() {
  const { architectChat, BackendService } = useSimulation();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [architectChat]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    BackendService.sendUserMessage(input.trim());
    setInput('');
  };

  return (
    <div className="flex-1 flex flex-col border-r border-gray-800 bg-gray-900 h-full relative">
      {/* Header */}
      <div className="h-10 border-b border-gray-800 flex items-center px-4 shrink-0 bg-gray-900/90 z-10">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Architect Chat</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <AnimatePresence initial={false}>
          {architectChat.map(msg => (
            <motion.div 
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex space-x-3 max-w-[90%]", 
                msg.role === 'user' ? "ml-auto flex-row-reverse space-x-reverse" : "mr-auto"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
                msg.role === 'user' ? "bg-blue-600" : "bg-purple-600"
              )}>
                {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Cpu className="w-4 h-4 text-white" />}
              </div>
              
              <div className={cn(
                "rounded-lg p-3 text-sm",
                msg.role === 'user' ? "bg-blue-600/20 text-blue-50" : "bg-gray-800 text-gray-200 border border-gray-700"
              )}>
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                {msg.isStreaming && <span className="inline-block w-2 h-4 bg-gray-400 ml-1 animate-pulse align-middle" />}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 shrink-0 bg-gray-900">
        <form onSubmit={handleSend} className="relative flex items-center">
          <input 
            type="text"
            className="w-full bg-gray-800 border border-gray-700 rounded-md py-2.5 pl-4 pr-12 text-sm text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-500"
            placeholder="Describe what you want to build..."
            value={input}
            onChange={e => setInput(e.target.value)}
          />
          <button 
            type="submit"
            disabled={!input.trim()}
            className="absolute right-2 p-1.5 rounded bg-blue-600 text-white disabled:bg-gray-700 disabled:text-gray-400 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
