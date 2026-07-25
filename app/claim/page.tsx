"use client";

// app/claim/page.tsx
//
// The web claim surface. A player reaches this from the link /mypage hands them in
// Discord. One button: "Continue with Discord". Signing in binds every character linked to
// their Discord account (via characters.discord_user_id) to their web profile, with no
// invite code, through claim_by_discord() in the /auth/callback ?claim=1 branch.
//
// WHY THIS REPLACED /join
//
// /join signed players in ANONYMOUSLY and bound the character to that throwaway identity,
// which is how characters got stranded when a player cleared cookies or later made a real
// account. This page never creates an anonymous session. The player authenticates with the
// Discord account that already owns their characters at the table, so the web identity and
// the table identity are the same thing from the first click, and can never drift apart.
//
// There is intentionally no invite-code path here. Discord is the source of truth.

import React from "react";
import DiscordButton from "@/components/discord-button";

export default function ClaimPage() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#1B1426", color: "#F4EEFA", padding: 24,
      fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
          Open your table
        </div>
        <p style={{ color: "#A597BD", fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
          Sign in with the Discord account you play on, and your character, your journal, and
          the party codex are all waiting. Nothing to type.
        </p>

        {/* next=/me sends the callback into its ?claim=1 handling, which runs
            claim_by_discord and then routes to the player's table. */}
        <DiscordButton next="/me?claimed=1" claim />

        <p style={{ color: "#6E6385", fontSize: 12.5, lineHeight: 1.55, marginTop: 20 }}>
          Use the same Discord you use at the table. That is how we know which characters are
          yours.
        </p>
      </div>
    </div>
  );
}
