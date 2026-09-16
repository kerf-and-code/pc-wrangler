"use client";

import { createClient } from "@/lib/supabase/client";
import { stoneButton } from "@/lib/forge-theme";
import { authHeading, authText, authLabel, authField, authError, authLink } from "@/components/auth/auth-shell";
import Link from "next/link";
import { useState } from "react";

// Rendered inside AuthShell (the dungeon panel), so this owns only the heading + form, not a card.

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (error) throw error;
      setSuccess(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <>
        <h1 style={authHeading}>Check your email</h1>
        <p style={{ ...authText, textAlign: "center", margin: 0 }}>
          If you registered with an email and password, a reset link is on its way.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 style={authHeading}>Reset your password</h1>
      <p style={{ ...authText, textAlign: "center", margin: "0 0 20px" }}>
        Enter your email and we&apos;ll send a link to reset your password.
      </p>
      <form onSubmit={handleForgotPassword} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label htmlFor="email" style={authLabel}>Email</label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={authField}
          />
        </div>
        {error && <p style={authError}>{error}</p>}
        <button
          type="submit"
          className="forge-btn is-primary"
          style={{ ...stoneButton("primary"), width: "100%" }}
          disabled={isLoading}
        >
          {isLoading ? "Sending..." : "Send reset email"}
        </button>
      </form>
      <p style={{ ...authText, textAlign: "center", fontSize: 13, margin: "16px 0 0" }}>
        Already have an account? <Link href="/auth/login" style={authLink}>Log in</Link>
      </p>
    </>
  );
}
