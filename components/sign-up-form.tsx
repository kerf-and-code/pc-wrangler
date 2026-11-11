"use client";

import { createClient } from "@/lib/supabase/client";
import { authHeading, authText, authLabel, authField, authError, authLink } from "@/components/auth/auth-shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TERMS_STATEMENT, TERMS_VERSION } from "@/lib/legal";
import Button from "@/components/ui-forge/Button";

// Rendered inside AuthShell (the dungeon panel), so this owns only the heading + form, not a card.
//
// Push 9 (audit T13): the form asks for the 18+ and terms statement, and stores which version was agreed
// in the account's metadata; the terms gate records it on the profile at first sign-in.

export function SignUpForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    if (!agreed) {
      setError("Tick the box to confirm you are 18 or older and agree to the terms.");
      setIsLoading(false);
      return;
    }

    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/protected`,
          data: { terms_version: TERMS_VERSION, terms_agreed_at: new Date().toISOString() },
        },
      });
      if (error) throw error;
      router.push("/auth/sign-up-success");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <h1 style={authHeading}>Create your account</h1>
      <form onSubmit={handleSignUp} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label htmlFor="email" style={authLabel}>Email</label>
          <input id="email" type="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} style={authField} />
        </div>
        <div>
          <label htmlFor="password" style={authLabel}>Password</label>
          <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={authField} />
        </div>
        <div>
          <label htmlFor="repeat-password" style={authLabel}>Repeat password</label>
          <input id="repeat-password" type="password" required value={repeatPassword} onChange={(e) => setRepeatPassword(e.target.value)} style={authField} />
        </div>
        <label style={{ ...authText, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.5, margin: 0, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => { setAgreed(e.target.checked); setError(null); }}
            style={{ width: 18, height: 18, marginTop: 2, flex: "0 0 auto" }}
          />
          <span>
            {TERMS_STATEMENT}{" "}
            <Link href="/terms" target="_blank" style={authLink}>Terms</Link>,{" "}
            <Link href="/privacy" target="_blank" style={authLink}>Privacy</Link>.
          </span>
        </label>
        {error && <p role="alert" style={authError}>{error}</p>}
        <Button variant="primary"
          type="submit"
          style={{ width: "100%" }}
          disabled={isLoading}
        >
          {isLoading ? "Creating your account..." : "Sign up"}
        </Button>
      </form>
      <p style={{ ...authText, textAlign: "center", fontSize: 13, margin: "16px 0 0" }}>
        Already have an account? <Link href="/auth/login" style={authLink}>Log in</Link>
      </p>
    </>
  );
}
