"use client";

import React from "react";
import { motion } from "framer-motion";

/**
 * Shared terminal-chrome primitives for the Map-tools panel modules
 * (Site screening, Measure distance, …) so the armed/status affordances
 * can't drift apart per tool.
 */

/** Status-rail config shape every tool's statusFor() resolves to. */
export interface ToolStatus {
  text: string;
  /** Tailwind bg-* class for the dot. */
  dot: string;
  /** Tailwind text-* class for the status word. */
  textColor: string;
  pulse: boolean;
}

/** Right side of a status rail: pulse dot + status word. */
export function StatusIndicator({ status }: { status: ToolStatus }) {
  return (
    <span className={`flex items-center gap-1.5 ${status.textColor}`}>
      <motion.span
        className={`h-1.5 w-1.5 rounded-full ${status.dot}`}
        animate={status.pulse ? { opacity: [1, 0.25, 1] } : { opacity: 1 }}
        transition={
          status.pulse
            ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.2 }
        }
      />
      {status.text}
    </span>
  );
}

/** Corner brackets framing an armed/active tool button (target-lock
 *  affordance shared by the draw buttons and the measure toggle). */
export function CornerBrackets() {
  const corner = "absolute h-2 w-2 border-sky-300/90";
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0, scale: 1.15 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="pointer-events-none absolute inset-0.5"
    >
      <span className={`${corner} left-0 top-0 border-l border-t`} />
      <span className={`${corner} right-0 top-0 border-r border-t`} />
      <span className={`${corner} bottom-0 left-0 border-b border-l`} />
      <span className={`${corner} bottom-0 right-0 border-b border-r`} />
    </motion.span>
  );
}
