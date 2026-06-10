import React from 'react';

/**
 * Shared page heading for the Finance engines (dashboard + calculator).
 *
 * A large gradient-clipped title — a bolder, more substantial treatment than
 * the tiny eyebrow it replaces.
 */
export default function EngineTitle({ title }: { title: string }) {
  return (
    <h1
      className="w-fit max-w-full text-xl sm:text-2xl font-black tracking-tight leading-tight
                 text-transparent bg-clip-text bg-gradient-to-r from-white via-[#d0e4ff] to-[#ffc87a]"
    >
      {title}
    </h1>
  );
}
