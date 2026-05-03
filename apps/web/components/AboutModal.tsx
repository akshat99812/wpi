import React from 'react';

export default function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0b0f19] max-w-4xl w-full rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-border bg-[#131826] flex justify-between items-center">
          <h2 className="text-xl font-bold text-text">About CECL</h2>
          <button onClick={onClose} className="text-muted hover:text-orange text-xl">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 text-sm text-muted">
          <p>
            CECL (Consulting Engineers Group) has been a trusted partner in the renewable energy sector since 1986. 
            With nearly 40 years of experience originating from Bhopal, we specialize in delivering high-fidelity geospatial intelligence, 
            wind resource assessment, and full-stack energy consulting.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-panel border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-orange">350+</div>
              <div className="text-xs uppercase tracking-wider mt-1">Clients</div>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-orange">600+</div>
              <div className="text-xs uppercase tracking-wider mt-1">Projects</div>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-orange">340+</div>
              <div className="text-xs uppercase tracking-wider mt-1">Locations</div>
            </div>
          </div>
          <div>
            <h3 className="text-text font-semibold mb-3">Capabilities</h3>
            <div className="flex flex-wrap gap-2">
              {['Wind Resource Assessment', 'Micrositing', 'LCOE Optimization', 'Grid Integration', 'Repowering Studies', 'Due Diligence'].map(cap => (
                <span key={cap} className="px-3 py-1 bg-[#1a2133] border border-[#27324a] rounded-full text-xs text-text">{cap}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-border bg-[#0e1428] flex justify-between items-center">
          <span className="text-xs text-muted">Press Esc to close</span>
          <button onClick={onClose} className="bg-orange hover:bg-orange-2 text-[#0b0f19] px-6 py-2 rounded-lg font-bold text-sm transition-colors">
            Visit cecl.in
          </button>
        </div>
      </div>
    </div>
  );
}
