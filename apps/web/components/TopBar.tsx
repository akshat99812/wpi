"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import AboutModal from './AboutModal';
import EngineModal from './Engines/EngineModal';

type EngineType = 'Finance' | 'Research' | 'Operators';

const ENGINES: { id: EngineType; icon: string; desc: string }[] = [
  { id: 'Finance',   icon: '📊', desc: 'DCF & Bankability' },
  { id: 'Research',  icon: '🔬', desc: 'Resource Intelligence' },
  { id: 'Operators', icon: '⚙️', desc: 'Fleet & O&M' },
];

const statsData = [
  { v: '350+', l: 'Clients' },
  { v: '600+', l: 'Projects' },
  { v: '340+', l: 'Sites' },
  { v: '15',   l: 'Sources' },
];

// Animation variants
const containerVariants: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { 
      duration: 0.6, 
      ease: 'easeOut',
      staggerChildren: 0.1 
    }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: -10 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5 }
  }
};

const statVariants: Variants = {
  hidden: { scale: 0.8, opacity: 0 },
  visible: { 
    scale: 1, 
    opacity: 1,
    transition: { type: 'spring', stiffness: 200, damping: 15 }
  },
  hover: {
    scale: 1.05,
    transition: { type: 'spring', stiffness: 400, damping: 10 }
  }
};

export default function TopBar({ 
  generatedAt,
  onRefresh,
  isRefreshing
}: { 
  generatedAt?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const [engineOpen, setEngineOpen] = useState<EngineType | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [hoveredEngine, setHoveredEngine] = useState<EngineType | null>(null);

  return (
    <>
      <motion.header 
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="flex-none relative flex items-center justify-between px-3 lg:px-6 py-2 lg:py-6 min-h-[52px] lg:h-[68px] overflow-hidden z-30"
        style={{ 
          background: 'linear-gradient(135deg, rgba(6,8,15,0.98) 0%, rgba(12,17,32,0.95) 50%, rgba(10,13,26,0.97) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)'
        }}
      >
        {/* Animated gradient borders */}
        <div className="absolute inset-x-0 top-0 h-px">
          <motion.div 
            className="h-full bg-gradient-to-r from-transparent via-orange/60 to-transparent"
            animate={{ 
              backgroundPosition: ['200% 0', '-200% 0'],
            }}
            transition={{ 
              duration: 8, 
              repeat: Infinity,
              ease: 'linear'
            }}
            style={{ backgroundSize: '200% 100%' }}
          />
        </div>
        
        {/* Bottom border */}
        <div className="absolute inset-x-0 bottom-0 h-px">
          <motion.div 
            className="h-full bg-gradient-to-r from-transparent via-white/12 to-transparent"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        {/* Ambient glow effects */}
        <motion.div 
          className="absolute left-0 top-0 w-96 h-full bg-orange/5 blur-3xl pointer-events-none"
          animate={{ 
            opacity: [0.3, 0.6, 0.3],
            scale: [1, 1.1, 1]
          }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="absolute right-0 top-0 w-96 h-full bg-blue-500/3 blur-3xl pointer-events-none"
          animate={{ 
            opacity: [0.2, 0.5, 0.2],
            scale: [1.1, 1, 1.1]
          }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* ── Brand ── */}
        <motion.div variants={itemVariants} className="flex items-center gap-2 lg:gap-4 z-10 min-w-0">
          {/* Logo */}
          <div className="relative w-8 h-8 sm:w-12 sm:h-12 lg:w-20 lg:h-20 flex items-center justify-center overflow-hidden flex-shrink-0">
            <Image
              src="/logo.svg"
              alt="CECL Energy"
              width={80}
              height={80}
              className="object-contain w-full h-full"
              priority
            />
          </div>

          {/* Brand text */}
          <div className="flex flex-col gap-0.5">
            <motion.span 
              className="text-[12px] sm:text-[15px] lg:text-[18px] font-black leading-none tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-[#d0e4ff] to-[#ffc87a]"
              animate={{ 
                backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
              }}
              transition={{ 
                duration: 5, 
                repeat: Infinity,
                ease: 'linear'
              }}
              style={{ backgroundSize: '200% 200%' }}
            >
              Wind Power India
            </motion.span>
            <span className="text-[9px] lg:text-[11px] font-medium text-white/35 tracking-[0.08em] hidden sm:block">
              Geospatial Wind Intelligence Terminal
            </span>
          </div>

          {/* Live badge with particle effect */}
          {generatedAt && (
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0d1f12]/80 border border-[#1a3a20] shadow-[0_0_20px_rgba(76,200,122,0.15)] backdrop-blur-sm"
            >
              <motion.div 
                className="w-2 h-2 rounded-full bg-[#4cc87a]"
                animate={{ 
                  scale: [1, 1.3, 1],
                  boxShadow: [
                    '0 0 6px #4cc87a',
                    '0 0 12px #4cc87a',
                    '0 0 6px #4cc87a'
                  ]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <span className="text-[11px] font-bold text-[#4cc87a] uppercase tracking-wider">Live</span>
            </motion.div>
          )}
        </motion.div>

        {/* ── Stats strip (center) ── */}
        <motion.div variants={itemVariants} className="hidden xl:flex items-center gap-1 z-10">
          {statsData.map((stat) => (
            <motion.div
              key={stat.l}
              variants={statVariants}
              whileHover="hover"
              className="relative flex flex-col items-center px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] cursor-default overflow-hidden group"
            >
              <motion.div 
                className="absolute inset-0 bg-gradient-to-t from-orange/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              />
              <motion.span 
                className="text-[15px] font-black text-orange leading-none relative z-10"
                initial={{ y: 0 }}
                whileHover={{ y: -2 }}
              >
                {stat.v}
              </motion.span>
              <span className="text-[10px] text-white/30 mt-0.5 tracking-wide relative z-10">
                {stat.l}
              </span>
            </motion.div>
          ))}
        </motion.div>

        {/* ── Engine buttons + About ── */}
        <motion.div variants={itemVariants} className="flex items-center gap-1.5 lg:gap-3 z-10 flex-shrink-0">
          {/* Engine switcher pill */}
          <motion.div 
            whileHover={{ scale: 1.02 }}
            className="flex items-center gap-1 lg:gap-2 p-1 lg:p-1.5 rounded-[20px] border border-white/[0.08]"
            style={{ 
              background: 'rgba(20, 25, 40, 0.5)', 
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05), 0 4px 20px rgba(0,0,0,0.3)' 
            }}
          >
            {ENGINES.map((engine, idx) => {
              const gradients = [
                'from-blue-500/20 to-cyan-500/10 border-blue-400/40 shadow-[0_0_20px_rgba(59,130,246,0.3)]',
                'from-purple-500/20 to-pink-500/10 border-purple-400/40 shadow-[0_0_20px_rgba(168,85,247,0.3)]',
                'from-emerald-500/20 to-green-500/10 border-emerald-400/40 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
              ];
              
              const textColors = [
                'text-blue-100',
                'text-purple-100',
                'text-emerald-100'
              ];

              return (
                <motion.button
                  key={engine.id}
                  onClick={() => setEngineOpen(engine.id)}
                  onHoverStart={() => setHoveredEngine(engine.id)}
                  onHoverEnd={() => setHoveredEngine(null)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`group relative flex items-center gap-1.5 lg:gap-2.5 px-2 lg:px-4 py-1.5 lg:py-2 rounded-2xl border transition-all duration-300 ${
                    hoveredEngine === engine.id 
                      ? `bg-gradient-to-br ${gradients[idx]}`
                      : 'border-transparent hover:bg-white/5'
                  }`}
                >
                  <motion.span 
                    className="text-[14px] lg:text-[18px] group-hover:scale-110 group-hover:-translate-y-0.5 transition-all duration-300 drop-shadow-md"
                    animate={hoveredEngine === engine.id ? {
                      rotate: [0, 10, -10, 0],
                      transition: { duration: 0.5 }
                    } : {}}
                  >
                    {engine.icon}
                  </motion.span>
                  <div className="hidden sm:flex flex-col items-start">
                    <span className={`text-[12.5px] font-bold leading-tight transition-colors duration-300 ${
                      hoveredEngine === engine.id 
                        ? textColors[idx]
                        : 'text-white/60'
                    }`}>
                      {engine.id}
                    </span>
                    <span className="text-[9.5px] text-white/30 leading-tight hidden lg:block font-medium tracking-wide">
                      {engine.desc}
                    </span>
                  </div>
                  
                  {/* Animated highlight on hover */}
                  {hoveredEngine === engine.id && (
                    <motion.div
                      layoutId="engineHighlight"
                      className="absolute inset-0 rounded-2xl opacity-20"
                      style={{
                        background: `radial-gradient(circle at center, transparent 0%, ${
                          idx === 0 ? 'rgba(59,130,246,0.3)' : 
                          idx === 1 ? 'rgba(168,85,247,0.3)' : 
                          'rgba(16,185,129,0.3)'
                        } 100%)`
                      }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </motion.button>
              );
            })}
          </motion.div>

          {/* Divider */}
          <motion.div 
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: 0.5 }}
            className="hidden sm:block w-px h-8 bg-white/10"
          />

          {/* About button */}
          <motion.button
            onClick={() => setAboutOpen(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6, type: 'spring' }}
            className="relative flex items-center gap-1.5 lg:gap-2 px-3 lg:px-8 py-2 lg:py-2.5 rounded-xl font-bold text-[11px] lg:text-[13px] text-orange border border-orange/30 overflow-hidden group"
            style={{ 
              background: 'rgba(255,138,31,0.08)', 
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)'
            }}
          >
            {/* Multiple animated gradient sweeps */}
            <motion.div 
              className="absolute inset-0 bg-gradient-to-r from-transparent via-orange/20 to-transparent"
              animate={{ 
                x: ['-100%', '200%']
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity,
                ease: 'linear'
              }}
            />
            <motion.div 
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
              animate={{ 
                x: ['-100%', '200%']
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity,
                delay: 1,
                ease: 'linear'
              }}
            />
            
            {/* Glow effect */}
            <motion.div 
              className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                boxShadow: '0 0 30px rgba(255,138,31,0.3), inset 0 0 20px rgba(255,138,31,0.1)'
              }}
            />
            
            <span className="relative z-10">About</span>
            
            {/* Animated corner decorations */}
            <motion.div 
              className="absolute top-0 left-0 w-2 h-2 border-t border-l border-orange/50 rounded-tl"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <motion.div 
              className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-orange/50 rounded-br"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, delay: 1 }}
            />
          </motion.button>
          {/* Refresh button */}
          {onRefresh && (
            <motion.button
              onClick={onRefresh}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.7, type: 'spring' }}
              className="relative flex items-center justify-center w-8 h-8 lg:w-10 lg:h-10 rounded-xl bg-white/[0.03] border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-colors shadow-sm"
              disabled={isRefreshing}
            >
              <motion.svg 
                xmlns="http://www.w3.org/2000/svg" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                className="w-4 h-4"
                animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
                transition={isRefreshing ? { repeat: Infinity, duration: 1, ease: "linear" } : {}}
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </motion.svg>
            </motion.button>
          )}
        </motion.div>
      </motion.header>

      <AnimatePresence>
        {engineOpen && (
          <EngineModal 
            initialEngine={engineOpen} 
            onClose={() => setEngineOpen(null)} 
          />
        )}
        {aboutOpen && (
          <AboutModal onClose={() => setAboutOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}