"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { createBrowser } from "@/lib/supabase/browser";

type Mode = "login" | "signup" | "forgot" | "reset";

const copy: Record<Mode, { title: string; cta: string }> = {
  login: { title: "Welcome back", cta: "Sign in" },
  signup: { title: "Start making videos", cta: "Create account" },
  forgot: { title: "Reset your password", cta: "Send reset link" },
  reset: { title: "Choose a new password", cta: "Update password" },
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/dashboard";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setNotice(null); setBusy(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "");
    const password = String(f.get("password") ?? "");
    const supabase = createBrowser();
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next); router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { data: { display_name: String(f.get("name") ?? "") || undefined }, emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.session) { router.replace("/dashboard"); router.refresh(); }
        else setNotice("Check your inbox to confirm your email, then sign in.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback?next=/reset-password` });
        if (error) throw error;
        setNotice("If that email has an account, a reset link is on its way.");
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        router.replace("/dashboard"); router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise w-full max-w-sm">
      <Link href="/" className="font-display text-lg text-muted hover:text-text">AI Video Studio</Link>
      <h1 className="font-display mt-6 text-4xl">{copy[mode].title}</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {mode === "signup" && <Field label="Name"><Input name="name" autoComplete="name" placeholder="Ada Lovelace" /></Field>}
        {mode !== "reset" && <Field label="Email"><Input name="email" type="email" required autoComplete="email" placeholder="you@studio.com" /></Field>}
        {mode !== "forgot" && (
          <Field label={mode === "reset" ? "New password" : "Password"} hint={mode !== "login" ? "At least 8 characters." : undefined}>
            <Input name="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </Field>
        )}
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="ok">{notice}</Alert>}
        <Button type="submit" busy={busy} className="w-full">{copy[mode].cta}</Button>
      </form>
      <div className="mt-6 flex justify-between text-sm text-muted">
        {mode === "login" && (<><Link href="/signup" className="hover:text-text">Create an account</Link><Link href="/forgot-password" className="hover:text-text">Forgot password?</Link></>)}
        {mode === "signup" && <Link href="/login" className="hover:text-text">Already have an account?</Link>}
        {(mode === "forgot" || mode === "reset") && <Link href="/login" className="hover:text-text">Back to sign in</Link>}
      </div>
    </div>
  );
}
