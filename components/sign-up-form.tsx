"use client";

import { createClient } from "@/lib/supabase/client";
import { stoneButton } from "@/lib/forge-theme";
import { authHeading, authText, authLabel, authField, authError, authLink } from "@/components/auth/auth-shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Rendered inside AuthShell (the dungeon panel), so this owns only the heading + form, not a card.

export function SignUpForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

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
        {error && <p style={authError}>{error}</p>}
        <button
          type="submit"
          className="forge-btn is-primary"
          style={{ ...stoneButton("primary"), width: "100%" }}
          disabled={isLoading}
        >
          {isLoading ? "Creating your account..." : "Sign up"}
        </button>
      </form>
      <p style={{ ...authText, textAlign: "center", fontSize: 13, margin: "16px 0 0" }}>
        Already have an account? <Link href="/auth/login" style={authLink}>Log in</Link>
      </p>
    </>
  );
}
