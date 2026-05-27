"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { AuthCard, Field, SubmitButton, ErrorText } from "../_components/AuthCard";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn.email({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message || "Incorrect email or password.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <AuthCard title="Log in" subtitle="Welcome back.">
      <form onSubmit={onSubmit}>
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        <SubmitButton loading={loading}>Log in</SubmitButton>
        <ErrorText message={error} />
      </form>
      <p className="mt-4 text-[11px] text-muted/60 text-center">
        New here?{" "}
        <Link href="/signup" className="text-orange hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
