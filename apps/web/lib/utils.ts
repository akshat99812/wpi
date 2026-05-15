type ClassValue = string | number | null | false | undefined | ClassValue[];

/** Tiny clsx replacement — joins truthy class fragments with a single space. */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'number' || typeof v === 'string') out.push(String(v));
  };
  inputs.forEach(walk);
  return out.join(' ');
}
