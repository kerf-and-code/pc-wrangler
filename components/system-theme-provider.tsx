"use client";

// Applies the active campaign's per-system theme by setting the CSS variables directly on <html>. This
// runs on the player and GM sides alike, and because it reads the session-scoped active campaign on every
// mount, the look PERSISTS across menus: pick a Lancer campaign in the workspace and the roller, encounter
// balancer, Forge, and every other page open already Lancer, with no re-selection.
//
// Setting the variables with style.setProperty (rather than an injected [data-system] stylesheet) is what
// makes this reliable in the App Router: the values land on the element itself and cannot be dropped by
// head-injection quirks. It also sets data-system for any CSS that wants to key on it. Clears back to the
// default look when there is no active campaign.

import { useEffect } from "react";
import { getActiveCampaign, onActiveCampaignChange } from "@/lib/active-campaign";
import { resolveSystemVars } from "@/lib/systems/system-theme";

export default function SystemThemeProvider() {
  useEffect(() => {
    const apply = () => {
      const sys = getActiveCampaign()?.system ?? null;
      const root = document.documentElement;
      const vars = resolveSystemVars(sys);
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
      if (sys) root.setAttribute("data-system", sys);
      else root.removeAttribute("data-system");
    };
    apply();
    return onActiveCampaignChange(apply);
  }, []);
  return null;
}
