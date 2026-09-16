"use client";

import { createClient } from "@/lib/supabase/client";
import { stoneButton } from "@/lib/forge-theme";
import { authHeading, authText, authLabel, authField, authError } from "@/components/auth/auth-shell";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Rendered inside AuthShell (the dungeon panel), so this owns only the heading + form, not a card.

export function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.push("/protected");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <h1 style={authHeading}>Set a new password</h1>
      <p style={{ ...authText, textAlign: "center", margin: "0 0 20px" }}>
        Enter your new password below.
      </p>
      <form onSubmit={handleUpdatePassword} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label htmlFor="password" style={authLabel}>New password</label>
          <input id="password" type="password" placeholder="New password" required value={password} onChange={(e) => setPassword(e.target.value)} style={authField} />
        </div>
        {error && <p style={authError}>{error}</p>}
        <button
          type="submit"
          className="forge-btn is-primary"
          style={{ ...stoneButton("primary"), width: "100%" }}
          disabled={isLoading}
        >
          {isLoading ? "Saving..." : "Save new password"}
        </button>
      </form>
    </>
  );
}
