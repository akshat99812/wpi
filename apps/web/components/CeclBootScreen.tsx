"use client";

import { useEffect, useState } from "react";
import { CeclLoader } from "./CeclLoader";

const DEFAULT_BOOT_MS = 1600; // 1–2s branded boot, matching the Pro map
const FADE_MS = 400;

type BootPhase = "visible" | "fading" | "gone";

/**
 * Full-screen branded boot overlay. Shows the CECL loader for `durationMs`,
 * then fades out and unmounts. Self-contained so it can be dropped into a
 * server-rendered page (e.g. the landing page) without making the page a
 * client component.
 */
export function CeclBootScreen({
  label = "Intelligence terminal is booting",
  durationMs = DEFAULT_BOOT_MS,
}: {
  label?: string;
  durationMs?: number;
}) {
  const [phase, setPhase] = useState<BootPhase>("visible");

  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase("fading"), durationMs);
    const goneTimer = setTimeout(() => setPhase("gone"), durationMs + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(goneTimer);
    };
  }, [durationMs]);

  if (phase === "gone") return null;

  return (
    <div
      className="fixed inset-0 z-[100] transition-opacity ease-out"
      style={{ opacity: phase === "fading" ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
      aria-hidden={phase === "fading"}
      role="status"
      aria-live="polite"
    >
      <CeclLoader label={label} />
    </div>
  );
}
