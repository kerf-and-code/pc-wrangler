// lib/owner.ts (push 17, audit F10)
//
// Who may use the owner console (/admin). OWNER_IDS is a comma-separated list of Supabase user ids,
// set in the server environment (Vercel, and .env.local for development). Server only: the list is
// never sent to the browser, and every owner API call checks it again.

export function ownerIds(): string[] {
  return (process.env.OWNER_IDS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isOwner(userId: string | null | undefined): boolean {
  return !!userId && ownerIds().includes(userId.toLowerCase());
}
