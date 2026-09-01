
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const FridayOS = () => {
  const [activeTab, setActiveTab] = useState('MissionControl');
  const [telemetry, setTelemetry] = useState({ cpu: 12, ram: 45, net: '120mbps' });

  return (
    <div className="min-h-screen bg-[#0B0E14] text-white font-mono overflow-hidden flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center p-4 border-b border-cyan-900/50 bg-black/40 backdrop-blur-md">
        <div className="text-cyan-400">CPU: {telemetry.cpu}% | RAM: {telemetry.ram}% | NET: {telemetry.net}</div>
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-widest">FRIDAY OS</h1>
          <p className="text-xs text-gray-400">{new Date().toLocaleDateString()} | {new Date().toLocaleTimeString()}</p>
        </div>
        <div className="text-cyan-400">SYSTEM STATUS: NOMINAL</div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Agent Log */}
        <aside className="w-64 border-r border-cyan-900/50 p-4">
          <h2 className="text-cyan-500 mb-4">LIVE AGENTS</h2>
          <div className="space-y-2">
            {['CodingAgent', 'ResearchAgent', 'SecurityGuard'].map(agent => (
              <div key={agent} className="p-2 bg-gray-900 hover:bg-cyan-900/20 cursor-pointer border border-transparent hover:border-cyan-500 transition-all">
                {agent}
              </div>
            ))}
          </div>
        </aside>

        {/* Center: The Orb */}
        <main className="flex-1 flex flex-col items-center justify-center relative">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="w-64 h-64 border-4 border-cyan-500/30 rounded-full relative flex items-center justify-center"
          >
            <div className="absolute w-48 h-48 border-2 border-cyan-400/50 rounded-full animate-pulse"></div>
            <div className="w-32 h-32 bg-cyan-500/20 rounded-full shadow-[0_0_50px_rgba(6,182,212,0.5)]"></div>
          </motion.div>

          <div className="mt-12 w-full max-w-2xl p-2 bg-black/60 border border-cyan-800 rounded-lg flex gap-2">
            <input className="flex-1 bg-transparent outline-none p-2 text-cyan-300" placeholder="Enter command..." />
            <button className="p-2 hover:bg-cyan-900">🎤</button>
            <button className="p-2 hover:bg-cyan-900">📷</button>
            <button className="p-2 hover:bg-cyan-900">📺</button>
          </div>
        </main>

        {/* Right Panel Tabs */}
        <aside className="w-80 border-l border-cyan-900/50 p-4">
          <nav className="flex flex-wrap gap-2 mb-4">
            {['Memory', 'MissionControl', 'Workflow', 'N8N', 'Agents', 'Connectors'].map(tab => (
              <button 
                key={tab} 
                onClick={() => setActiveTab(tab)}
                className={`p-2 text-sm ${activeTab === tab ? 'bg-cyan-600 text-white' : 'bg-gray-800'}`}
              >
                {tab}
              </button>
            ))}
          </nav>
          <div className="p-4 border border-cyan-800 rounded h-64 overflow-y-auto">
            {activeTab} Content Area
          </div>
        </aside>
      </div>
    </div>
  );
};

export default FridayOS;
