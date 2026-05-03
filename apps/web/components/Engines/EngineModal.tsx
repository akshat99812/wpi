import React, { useState } from 'react';
import FinanceDashboard from './FinanceDashboard';
import BankabilityCalc from './BankabilityCalc';
import ResearchDashboard from './ResearchDashboard';
import AITopicSearch from './AITopicSearch';

type EngineType = 'Finance' | 'Research' | 'Operators';

interface EngineModalProps {
  initialEngine: EngineType;
  onClose: () => void;
}

export default function EngineModal({ initialEngine, onClose }: EngineModalProps) {
  const [activeEngine, setActiveEngine] = useState<EngineType>(initialEngine);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity duration-200" onClick={onClose}>
      <div 
        className="w-full max-w-[1400px] h-[92vh] max-h-[880px] bg-gradient-to-b from-[#0e1422] to-[#090d18] rounded-xl border border-[#2a3350] shadow-2xl flex flex-col overflow-hidden transform transition-transform duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header bar */}
        <header className="flex-none px-5 py-3.5 flex justify-between items-center bg-gradient-to-b from-[#13192a] to-[#0c111d] border-b border-[#1f2740]">
          <div className="flex items-center gap-3.5">
            <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center bg-gradient-to-br from-orange/20 to-orange/5 border border-orange/40 text-orange-200">
              {/* Icon placeholder */}
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <div className="text-[10px] tracking-[1.2px] text-orange font-bold uppercase mb-0.5">Persona Engine</div>
              <h2 className="text-lg font-bold text-text m-0">{activeEngine} Intelligence</h2>
            </div>
          </div>

          <div className="flex gap-1 bg-[#0a0e18] border border-border rounded-lg p-1">
            {(['Finance', 'Research', 'Operators'] as EngineType[]).map((engine) => (
              <button
                key={engine}
                onClick={() => setActiveEngine(engine)}
                disabled={engine === 'Operators'}
                className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.6px] rounded-md transition-colors flex items-center gap-1.5 ${
                  activeEngine === engine 
                    ? 'bg-gradient-to-br from-[#2a1f11] to-[#1a130a] text-[#ffd7a8] shadow-[inset_0_0_0_1px_rgba(255,138,31,0.32)]' 
                    : engine === 'Operators' 
                      ? 'opacity-50 cursor-not-allowed text-muted' 
                      : 'text-muted hover:text-orange-200 bg-transparent'
                }`}
              >
                {engine}
                {engine === 'Operators' && (
                  <span className="bg-gradient-to-br from-orange to-[#ffb066] text-[#14181f] px-1 py-[1px] rounded-[3px] text-[8px] font-extrabold tracking-[0.4px] leading-[1.4]">PRO</span>
                )}
              </button>
            ))}
          </div>

          <button onClick={onClose} className="w-[34px] h-[34px] rounded-lg border border-border text-muted hover:text-orange hover:border-orange hover:bg-orange/10 flex items-center justify-center text-xl transition-all">
            &times;
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {activeEngine === 'Finance' && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] overflow-hidden min-h-0">
              {/* Left Column */}
              <div className="bg-[#0a0e18] border-r border-[#1f2740] overflow-y-auto custom-scrollbar p-5">
                 <FinanceDashboard />
              </div>
              {/* Right Column */}
              <div className="bg-[#0c1120] overflow-y-auto custom-scrollbar p-5">
                 <BankabilityCalc />
              </div>
            </div>
          )}
          
          {activeEngine === 'Research' && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] overflow-hidden min-h-0">
              {/* Left Column */}
              <div className="bg-[#0a0e18] border-r border-[#1f2740] overflow-y-auto custom-scrollbar p-5">
                 <ResearchDashboard />
              </div>
              {/* Right Column */}
              <div className="bg-[#0c1120] overflow-y-auto custom-scrollbar p-5">
                 <AITopicSearch />
              </div>
            </div>
          )}
          
          {activeEngine === 'Operators' && (
             <div className="p-8 text-muted text-center flex items-center justify-center h-full">Operators Engine (Coming Soon)</div>
          )}
        </div>
      </div>
    </div>
  );
}
