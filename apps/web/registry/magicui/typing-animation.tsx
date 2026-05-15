"use client";

/**
 * TypingAnimation — typewriter effect that cycles through `words[]`,
 * typing each one character-by-character, pausing, then deleting and
 * moving to the next. Models the magic-ui registry component the same
 * way the upstream version does (just self-hosted under
 * apps/web/registry/magicui/).
 *
 * Usage:
 *   <TypingAnimation words={["Design 🎨", "Build 🔨", "Ship 🚀"]} loop />
 */
import React, { useEffect, useMemo, useState } from 'react';

interface Props {
  words:        string[];
  loop?:        boolean;  // restart from the first word after the last (default true)
  typingMs?:    number;   // ms per character while typing
  deletingMs?:  number;   // ms per character while deleting
  holdMs?:      number;   // ms to hold a completed word before deleting
  className?:  string;
  cursorClassName?: string;
}

export function TypingAnimation({
  words,
  loop          = true,
  typingMs      = 70,
  deletingMs    = 40,
  holdMs        = 1300,
  className     = '',
  cursorClassName = '',
}: Props) {
  const safeWords = useMemo(() => (words.length > 0 ? words : ['']), [words]);
  const [idx, setIdx]       = useState(0);
  const [chars, setChars]   = useState(0);
  const [deleting, setDelete] = useState(false);

  useEffect(() => {
    const current = safeWords[idx] ?? '';
    let timer: ReturnType<typeof setTimeout>;

    if (!deleting && chars < current.length) {
      // still typing forward
      timer = setTimeout(() => setChars(c => c + 1), typingMs);
    } else if (!deleting && chars === current.length) {
      // word complete — hold, then start deleting (unless loop=false and last)
      const isLast = idx === safeWords.length - 1;
      if (!loop && isLast) return; // stop forever
      timer = setTimeout(() => setDelete(true), holdMs);
    } else if (deleting && chars > 0) {
      // deleting characters
      timer = setTimeout(() => setChars(c => c - 1), deletingMs);
    } else {
      // deletion complete — advance to next word
      setDelete(false);
      setIdx(i => (i + 1) % safeWords.length);
    }

    return () => clearTimeout(timer);
  }, [chars, deleting, idx, safeWords, loop, typingMs, deletingMs, holdMs]);

  const word = safeWords[idx] ?? '';
  return (
    <span className={className}>
      {word.slice(0, chars)}
      <span
        aria-hidden
        className={`inline-block w-[1ch] -ml-[0.05em] ${cursorClassName || 'opacity-70'}`}
        style={{ animation: 'tw-blink 1s steps(2, start) infinite' }}
      >
        |
      </span>
      <style>{`@keyframes tw-blink { to { visibility: hidden; } }`}</style>
    </span>
  );
}
