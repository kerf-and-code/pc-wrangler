// lib/tabletop/open.ts (2026-11-07)
//
// Open the tabletop in its own window, so it can sit on a second screen beside the Combat page or a
// character sheet. One named window per campaign: opening it again brings that window forward instead
// of stacking copies. Falls back to the current tab if the browser blocks the window.

export function tabletopUrl(campaignId: string): string {
  return `/tabletop/${encodeURIComponent(campaignId)}`;
}

export function openTabletop(campaignId: string): void {
  const url = tabletopUrl(campaignId);
  const w = window.open(url, `sixaxes-tabletop-${campaignId}`, "popup=yes,width=1600,height=1000");
  if (w) { try { w.focus(); } catch { /* ignore */ } return; }
  window.location.href = url;
}
