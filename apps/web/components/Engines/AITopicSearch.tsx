"use client";

import React, { useState } from 'react';

const TOPICS = [
  'Repowering', 'Offshore Gujarat', 'Wake losses', 'Hybrid+BESS', 
  'RPO compliance', 'Forecasting', 'LCOE', 'Micro-siting', 
  'Land & siting', 'Green hydrogen', 'FDRE/RTC', 'ALMM-II', 
  'DSM', 'Floating offshore', 'P50/P75/P90', 'GIB & siting'
];

const SOURCES = [
  'Google Scholar', 'arXiv', 'SSRN', 'NIWE Wind Atlas', 'Global Wind Atlas', 
  'Mercom India', 'JMK Research', 'Reuters India', 'Times of India', 
  'The Hindu BusinessLine', 'Mongabay India', 'PIB India', 'MNRE site', 'CEA & CERC'
];

export default function AITopicSearch() {
  const [query, setQuery] = useState('');

  const handleSearch = () => {
    if (!query) return;
    window.open(`https://www.google.com/search?q=site:india+wind+energy+${encodeURIComponent(query)}`, '_blank');
  };

  return (
    <div className="flex flex-col h-full gap-5">
      <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold mb-2">
         <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange to-transparent"></div>
         AI Topic Search
       </div>

       <div className="bg-[#131826] border border-border rounded-xl p-5 flex flex-col gap-4">
         <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="Query wind topics (e.g. 'offshore VGF support')..."
              className="flex-1 bg-[#0b0f19] border border-[#2a3350] rounded-lg px-4 py-2 text-sm text-text focus:outline-none focus:border-orange/50 transition-colors"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button 
              onClick={handleSearch}
              className="bg-orange hover:bg-orange-600 text-[#0b0f19] px-6 py-2 rounded-lg font-bold text-sm transition-colors"
            >
              Search
            </button>
         </div>

         <div className="flex flex-wrap gap-2">
           {TOPICS.map(topic => (
             <button 
               key={topic}
               onClick={() => setQuery(topic)}
               className="px-3 py-1 bg-[#1a2133] border border-[#27324a] rounded-full text-[10px] text-text hover:border-orange/50 transition-colors"
             >
               {topic}
             </button>
           ))}
         </div>
       </div>

       <div className="flex-1 overflow-y-auto custom-scrollbar">
         <div className="text-[10px] text-muted font-bold uppercase tracking-[1.2px] mb-3">Curated Sources</div>
         <div className="grid grid-cols-2 gap-2">
           {SOURCES.map(source => (
             <div key={source} className="flex items-center gap-2 p-2 bg-[#0b0f19] border border-[#1a2138] rounded-lg group hover:border-orange/30 transition-colors">
               <div className="w-1.5 h-1.5 rounded-full bg-orange/40 group-hover:bg-orange transition-colors"></div>
               <span className="text-[11px] text-muted group-hover:text-text">{source}</span>
             </div>
           ))}
         </div>
       </div>

       <div className="bg-gradient-to-br from-[#1a140a] to-[#0d0d0d] border border-orange/20 rounded-xl p-4 mt-auto">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-[10px] text-orange font-bold uppercase mb-1">Unlock CECL Pro</div>
              <div className="text-xs text-text font-semibold">Full text access & PDF indexing</div>
            </div>
            <div className="text-lg">✨</div>
          </div>
       </div>
    </div>
  );
}
