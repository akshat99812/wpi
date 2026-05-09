import React from 'react';

interface Props {
  isFullscreen: boolean;
  onToggle: () => void;
}

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9V4h5" />
    <path d="M20 9V4h-5" />
    <path d="M4 15v5h5" />
    <path d="M20 15v5h-5" />
  </svg>
);

const CollapseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 4v5H4" />
    <path d="M15 4v5h5" />
    <path d="M9 20v-5H4" />
    <path d="M15 20v-5h5" />
  </svg>
);

export function FullscreenButton({ isFullscreen, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      className="w-8 h-8 flex items-center justify-center bg-black/65 backdrop-blur-md border border-white/10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all shadow-xl"
    >
      {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
    </button>
  );
}
