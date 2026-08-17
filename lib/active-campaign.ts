// The "active campaign" the GM is currently working in. A lightweight session-scoped signal that the
// nav reads to hide tools a system doesn't support, and that tools can read to default their picker.
//
// Session-scoped (sessionStorage) on purpose, like the player share code: it's "what I'm looking at
// right now", not a durable preference. Any surface where the GM picks a campaign should call
// setActiveCampaign so the nav stays honest; the nav subscribes via onActiveCampaignChange and
// re-gates live (same-tab custom event + cross-tab storage event).

export type ActiveCampaign = { id: string; name?: string; system: string | null };

const KEY = "sax_active_campaign";
const EVT = "sax-active-campaign";

export function setActiveCampaign(c: ActiveCampaign | null): void {
  if (typeof window === "undefined") return;
  try {
    if (c && c.id) sessionStorage.setItem(KEY, JSON.stringify(c));
    else sessionStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(EVT));
  } catch { /* storage disabled; the nav just won't gate */ }
}

export function getActiveCampaign(): ActiveCampaign | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActiveCampaign) : null;
  } catch {
    return null;
  }
}

// Subscribe to changes. Fires on same-tab setActiveCampaign (custom event) and cross-tab writes
// (storage event). Returns an unsubscribe.
export function onActiveCampaignChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const storage = (e: StorageEvent) => { if (e.key === null || e.key === KEY) fn(); };
  window.addEventListener(EVT, fn);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(EVT, fn); window.removeEventListener("storage", storage); };
}
