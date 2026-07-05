"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = {
  surface: SAX.slateBg, line: SAX.line, text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum,
};

type Item = { item_kind: string; item_type: string; id: string; title: string; body: string | null };

const GROUPS: { type: string; label: string }[] = [
  { type: "npc", label: "People" },
  { type: "location", label: "Places" },
  { type: "lore", label: "Lore" },
  { type: "note", label: "Notes" },
];

export default function PlayerLorePage() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "invalid">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const shareCode = new URLSearchParams(window.location.search).get("share");
      if (!shareCode) { if (active) setStatus("invalid"); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error: signErr } = await supabase.auth.signInAnonymously();
        if (signErr) { if (active) setStatus("invalid"); return; }
      }

      const { data: rows } = await supabase.rpc("codex_for_player", { p_share: shareCode });
      if (!active) return;
      const list = (rows as Item[]) || [];
      setItems(list);
      setStatus(list.length ? "ready" : "empty");
    })();
    return () => { active = false; };
  }, [supabase]);

  const eyebrow = { fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase" as const, color: C.muted };
  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px", marginBottom: 12, textAlign: "left" as const };

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 640, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <span style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, fontWeight: 700 }}>What you know</span>
        </div>
        <div style={{ ...eyebrow, textAlign: "center", marginBottom: 18 }}>PEOPLE, PLACES, AND LORE YOU&rsquo;VE LEARNED</div>
        <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, marginBottom: 24 }} />

        {status === "loading" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>Loading&hellip;</p>}
        {status === "invalid" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>This link looks broken. Ask your GM for the campaign link.</p>
        )}
        {status === "empty" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            Nothing to show yet. As you meet people and uncover places, what your character learns will gather here.
          </p>
        )}

        {status === "ready" && GROUPS.map((g) => {
          const group = items.filter((it) => it.item_type === g.type);
          if (!group.length) return null;
          return (
            <div key={g.type} style={{ marginBottom: 20 }}>
              <div style={{ ...eyebrow, color: C.sun, marginBottom: 10 }}>{g.label}</div>
              {group.map((it) => (
                <div key={it.id} style={card}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: it.body ? 6 : 0 }}>{it.title}</div>
                  {it.body && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 14, color: C.muted }}>{it.body}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
