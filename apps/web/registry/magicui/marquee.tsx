import { type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  /** Extra classes — also accepts `[--duration:30s]` / `[--gap:1rem]` */
  className?: string;
  /** Reverse the animation direction */
  reverse?: boolean;
  /** Pause when the user hovers the strip */
  pauseOnHover?: boolean;
  /** Marquee content (repeated `repeat` times to fill the loop) */
  children: React.ReactNode;
  /** Animate vertically instead of horizontally */
  vertical?: boolean;
  /** How many copies of `children` to render. 4 is enough to feel seamless. */
  repeat?: number;
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  ...props
}: MarqueeProps) {
  return (
    <div
      {...props}
      className={cn(
        "flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] [gap:var(--gap)]",
        vertical ? "flex-col" : "flex-row",
        pauseOnHover && "marquee-pause",
        className,
      )}
    >
      {Array.from({ length: repeat }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "flex shrink-0 justify-around [gap:var(--gap)]",
            vertical ? "animate-marquee-vertical flex-col" : "animate-marquee flex-row",
            reverse && "[animation-direction:reverse]",
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
