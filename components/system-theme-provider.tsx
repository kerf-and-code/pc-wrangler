"use client";

// Sets `data-system` on <html> from the active campaign, so the per-system CSS variables in
// lib/systems/system-theme.ts take effect and the whole app re-skins when the GM (or player) switches
// campaign. Renders nothing. Session-scoped, like the active campaign itself: it reflects "what I'm
// looking at right now", and clears back to the default look when there is no active campaign.

import { useEffect } from "react";
import { getActiveCampaign, onActiveCampaignChange } from "@/lib/active-campaign";

export default function SystemThemeProvider() {
  useEffect(() => {
    const apply = () => {
      const sys = getActiveCampaign()?.system;
      const root = document.documentElement;
      if (sys) root.setAttribute("data-system", sys);
      else root.removeAttribute("data-system");
    };
    apply();
    return onActiveCampaignChange(apply);
  }, []);
  return null;
}
