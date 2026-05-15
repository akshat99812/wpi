"use client";

import { type ComponentPropsWithoutRef } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

const animationProps = {
  initial: { "--x": "100%", scale: 0.98 },
  animate: { "--x": "-100%", scale: 1 },
  whileTap: { scale: 0.96 },
  transition: {
    repeat: Infinity,
    repeatType: "loop" as const,
    repeatDelay: 1,
    type: "spring" as const,
    stiffness: 20,
    damping: 15,
    mass: 2,
    scale: {
      type: "spring" as const,
      stiffness: 200,
      damping: 5,
      mass: 0.5,
    },
  },
};

interface ShinyButtonProps
  extends Omit<ComponentPropsWithoutRef<typeof motion.a>, "ref"> {
  children: React.ReactNode;
  className?: string;
  href: string;
}

export function ShinyButton({ children, className, ...props }: ShinyButtonProps) {
  return (
    <motion.a
      {...animationProps}
      {...props}
      className={cn(
        "group relative inline-flex items-center justify-center rounded-lg",
        "px-7 py-3.5 font-semibold tracking-tight",
        "bg-gradient-to-r from-orange to-[#ffb066] text-[#0a0e18]",
        "shadow-[0_12px_32px_-10px_rgba(255,138,31,0.55)]",
        "hover:shadow-[0_16px_40px_-10px_rgba(255,138,31,0.72)]",
        "transition-shadow duration-200",
        className,
      )}
    >
      {/* Sweeping shine overlay — uses the --x CSS variable animated above. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      >
        <span
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(-75deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)",
            maskImage:
              "linear-gradient(black, black) content-box, linear-gradient(black, black)",
            WebkitMaskImage:
              "linear-gradient(black, black) content-box, linear-gradient(black, black)",
            maskComposite: "exclude",
            WebkitMaskComposite: "xor",
            padding: "1px",
            transform: "translateX(var(--x))",
          }}
        />
      </span>

      <span className="relative inline-flex items-center gap-2.5">
        {children}
      </span>
    </motion.a>
  );
}
