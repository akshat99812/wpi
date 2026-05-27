"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth-client";
import { AuthCard, Field, SubmitButton, ErrorText } from "../_components/AuthCard";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signUp.email({ email, password, name });
    setLoading(false);
    if (error) {
      setError(error.message || "Could not create account.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthCard title="Create your account">
      <form onSubmit={onSubmit}>
        <Field
          label="Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
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
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
        <SubmitButton loading={loading}>Create account</SubmitButton>
        <ErrorText message={error} />
      </form>
      <p className="mt-4 text-[11px] text-muted/60 text-center">
        Already have one?{" "}
        <Link href="/login" className="text-orange hover:underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
