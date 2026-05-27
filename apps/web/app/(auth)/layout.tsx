import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#07090f] text-text flex flex-col">
      <header className="border-b border-white/5">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center">
          <Link href="/" className="text-[12px] font-bold tracking-wide text-text hover:text-orange transition-colors">
            ← Wind Power India
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
