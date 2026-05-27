"use client";

import { ReactNode } from "react";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-[#0d1628] border border-[#1e2c44] rounded-2xl p-7 shadow-2xl">
      <h1 className="text-[18px] font-bold text-text mb-1">{title}</h1>
      {subtitle && (
        <p className="text-[12px] text-muted/70 mb-5">{subtitle}</p>
      )}
      {children}
    </div>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block mb-3">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-muted/70 mb-1">
        {label}
      </span>
      <input
        {...props}
        className="w-full px-3 py-2 rounded-lg bg-[#07090f] border border-[#1e2c44] text-[13px] text-text placeholder:text-muted/40 focus:outline-none focus:border-orange/50 transition-colors"
      />
    </label>
  );
}

export function SubmitButton({
  children,
  loading,
  disabled,
}: {
  children: ReactNode;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full mt-2 px-3 py-2 rounded-lg bg-orange text-[#07090f] text-[13px] font-bold hover:bg-orange/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? "…" : children}
    </button>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-3 text-[11px] text-[#e85c5c] bg-[#1c0d0d]/60 border border-[#3a1515]/60 rounded-lg px-3 py-2">
      {message}
    </p>
  );
}
