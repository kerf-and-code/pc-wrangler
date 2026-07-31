"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SAX } from "@/lib/theme";
import { C } from "@/lib/forge-theme";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      style={{
        background: "none",
        color: SAX.brass,
        border: `1px solid ${C.brassDim}`,
        borderRadius: 9,
        padding: "7px 14px",
        fontSize: 13,
        fontWeight: 600,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      {busy ? "Signing out..." : "Sign out"}
    </button>
  );
}

export default LogoutButton;
