import Image from "next/image";

/**
 * Branded CECL loading visual — the energy "bolt" logo charges in a breathing
 * pulse while a conic ring sweeps around it. Fills its nearest positioned
 * ancestor (`absolute inset-0`), so callers control the framing (the Pro map
 * mounts it in a fixed panel; the boot screen wraps it in a fixed overlay).
 *
 * Animation classes (`animate-cecl-*`) live in app/globals.css.
 */
export function CeclLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-slate-950/85 backdrop-blur-sm">
      <div className="relative grid h-28 w-28 place-items-center">
        {/* Sweeping conic ring */}
        <div
          aria-hidden
          className="animate-cecl-ring absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(225,29,29,0.0) 200deg, rgba(225,29,29,0.85) 340deg, transparent 360deg)",
            WebkitMask:
              "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          }}
        />
        {/* Static faint track behind the ring */}
        <div aria-hidden className="absolute inset-0 rounded-full border border-white/5" />
        {/* Charging logo */}
        <Image
          src="/logo.png"
          alt="CECL"
          width={80}
          height={68}
          priority
          className="animate-cecl-charge relative h-16 w-16 object-contain"
        />
      </div>
      <p className="animate-cecl-flicker text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-300">
        {label}
      </p>
    </div>
  );
}
