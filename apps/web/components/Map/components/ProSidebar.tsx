import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Collapsible tool card for the Pro map, floating at the top-left or top-right
 * (set `side`). Two states, swapped with a cross-fade:
 *  - collapsed → a compact rounded launcher showing one icon button per tool;
 *  - expanded  → a rounded card with a header (active tool's icon + label and a
 *    collapse chevron) and the active tool's scrollable content. When more than
 *    one tool exists, a thin icon-tab row under the header switches between them.
 *
 * Designed to host many tools over time — pass each as a `ProTool`. Fully
 * controlled: the parent owns `open` and `activeId` so it can, e.g., auto-open
 * the card to a specific tool when the user clicks a map feature.
 */

export interface ProTool {
  id: string;
  /** Title shown in the card header and the launcher-icon tooltip. */
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** A small dot on the tool icon — e.g. to signal the tool has fresh data. */
  badge?: boolean;
  content: React.ReactNode;
}

interface Props {
  tools: ProTool[];
  activeId: string;
  open: boolean;
  onActiveChange: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  /** Which edge the card docks to. Default 'left'. */
  side?: 'left' | 'right';
}

const CARD_W = 320; // px
const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.7 } as const;

export function ProSidebar({
  tools,
  activeId,
  open,
  onActiveChange,
  onOpenChange,
  side = 'left',
}: Props) {
  const active = tools.find((t) => t.id === activeId) ?? tools[0];

  // Slide in from / collapse toward the docked edge.
  const enterX = side === 'right' ? 24 : -24;
  // Collapse chevron points toward the edge the card hugs.
  const collapseDir = side === 'right' ? 'right' : 'left';

  // Clicking a launcher/tab icon: open it, or collapse if it's already the
  // open tool.
  const handleToolClick = (id: string) => {
    if (open && id === activeId) {
      onOpenChange(false);
      return;
    }
    onActiveChange(id);
    onOpenChange(true);
  };

  return (
    <div
      className={
        'pointer-events-none absolute inset-y-0 z-20 flex items-start p-3 ' +
        (side === 'right' ? 'right-0' : 'left-0')
      }
    >
      <AnimatePresence initial={false} mode="wait">
        {open && active ? (
          <motion.aside
            key="pro-card"
            initial={{ x: enterX, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: enterX, opacity: 0 }}
            transition={SPRING}
            className="pointer-events-auto flex max-h-full flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur"
            style={{ width: CARD_W, maxWidth: 'calc(100vw - 24px)' }}
          >
            <header className="flex items-center justify-between gap-2 border-b border-slate-700/70 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <active.Icon className="h-4 w-4 shrink-0 text-sky-400" />
                <h2 className="truncate text-sm font-semibold tracking-tight text-white">
                  {active.label}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Collapse panel"
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
              >
                <Chevron dir={collapseDir} />
              </button>
            </header>

            {tools.length > 1 && (
              <div className="flex items-center gap-1 border-b border-slate-700/70 px-2 py-1.5">
                {tools.map((t) => {
                  const isActive = t.id === activeId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleToolClick(t.id)}
                      title={t.label}
                      aria-label={t.label}
                      aria-pressed={isActive}
                      className={
                        'relative grid h-8 w-8 place-items-center rounded-lg transition-colors ' +
                        (isActive
                          ? 'bg-sky-500/15 text-sky-300'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-100')
                      }
                    >
                      <t.Icon className="h-[18px] w-[18px]" />
                      {t.badge && (
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-sky-400 ring-2 ring-slate-900" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">{active.content}</div>
          </motion.aside>
        ) : (
          <motion.nav
            key="pro-launcher"
            aria-label="Map tools"
            initial={{ x: enterX, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: enterX, opacity: 0 }}
            transition={SPRING}
            className="pointer-events-auto flex flex-col items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur"
          >
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleToolClick(t.id)}
                title={t.label}
                aria-label={`Open ${t.label}`}
                aria-expanded={false}
                className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-slate-100"
              >
                <t.Icon className="h-5 w-5" />
                {t.badge && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-sky-400 ring-2 ring-slate-900" />
                )}
              </button>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="h-4 w-4" aria-hidden
    >
      {dir === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}
