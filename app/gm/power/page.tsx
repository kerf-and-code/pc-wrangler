"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX, surfaces, ui } from "@/lib/theme";

/* Six Axes — the Power Room.
   The DM throws a wall-mounted breaker to animate the disposition engine. The
   switch is a flipbook (open to closed) driven by a drag-down or the button;
   two alive frames alternate to crackle while the cloud fit runs. State stays
   honest: latches only while a fit runs, flashes alive on done, snaps back on
   error. Sits on the big wall image via PageShell. */

type Phase = "dormant" | "arming" | "animating" | "alive" | "fault";
type Campaign = { id: string; name: string };

const PULL_PX = 200;
const COMMIT = 0.8;

const FRAMES = ["/breaker-open.png", "/breaker-1.png", "/breaker-2.png", "/breaker-3.png", "/breaker-closed.png"];
const ALIVE = ["/breaker-alive-1.png", "/breaker-alive-2.png"];

export default function PowerRoomPage() {
  const supabase = createClient();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("dormant");
  const [pull, setPull] = useState(0);
  const [fault, setFault] = useState<string>("");

  const runIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragStartY = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    [...FRAMES, ...ALIVE].forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id,name").order("created_at");
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length && !campaignId) setCampaignId(list[0].id);
    })();
    return () => stopPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      const { data } = await supabase
        .from("disposition_runs")
        .select("id,status,created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(1);
      const latest = (data as { id: string; status: string; created_at: string }[] | null)?.[0];
      const fresh = latest && Date.now() - new Date(latest.created_at).getTime() < 30 * 60 * 1000;
      if (latest && latest.status === "fitting" && fresh) {
        runIdRef.current = latest.id;
        setPull(1);
        setPhase("animating");
        startPoll();
      } else {
        stopPoll();
        runIdRef.current = null;
        setPhase("dormant");
        animatePull(0);
        setFault("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const animatePull = useCallback((target: number, then?: () => void) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const step = () => {
      setPull((p) => {
        const next = p + (target - p) * 0.18;
        if (Math.abs(target - next) < 0.004) {
          rafRef.current = null;
          then?.();
          return target;
        }
        rafRef.current = requestAnimationFrame(step);
        return next;
      });
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  const startPoll = () => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      const id = runIdRef.current;
      if (!id) return;
      const { data } = await supabase.from("disposition_runs").select("status,error").eq("id", id).single();
      const row = data as { status: string; error: string | null } | null;
      if (!row) return;
      if (row.status === "done") {
        stopPoll();
        setPhase("alive");
        setTimeout(() => animatePull(0, () => setPhase("dormant")), 3600);
      } else if (row.status === "error") {
        stopPoll();
        setFault(row.error || "The engine faulted during the fit.");
        setPhase("fault");
        animatePull(0);
      }
    }, 2500);
  };

  const engage = useCallback(async () => {
    setPhase("animating");
    animatePull(1);
    try {
      const res = await fetch("/api/dispositions/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.runId) {
        setFault(body?.error || "The engine would not start.");
        setPhase("fault");
        animatePull(0);
        return;
      }
      runIdRef.current = body.runId;
      startPoll();
    } catch {
      setFault("Could not reach the engine. Check your connection and try again.");
      setPhase("fault");
      animatePull(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const canThrow = phase === "dormant" || phase === "fault";

  const onDown = (e: React.PointerEvent) => {
    if (!canThrow || !campaignId) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStartY.current = e.clientY;
    setFault("");
    setPhase("arming");
  };
  const onMove = (e: React.PointerEvent) => {
    if (phase !== "arming" || dragStartY.current === null) return;
    setPull(Math.max(0, Math.min(1, (e.clientY - dragStartY.current) / PULL_PX)));
  };
  const onUp = () => {
    if (phase !== "arming") return;
    dragStartY.current = null;
    setPull((p) => {
      if (p >= COMMIT) {
        engage();
        return 1;
      }
      animatePull(0);
      setPhase("dormant");
      return p;
    });
  };

  const throwIt = () => {
    if (!canThrow || !campaignId) return;
    setFault("");
    engage();
  };

  const seated = pull > 0.985;
  const live = phase === "animating" || phase === "alive";
  const showAlive = live && seated;
  const frameIdx = Math.round(pull * (FRAMES.length - 1));

  const plate = {
    dormant: { big: "Dormant", sub: "Pull the lever down, or hit the switch." },
    arming: { big: "…", sub: "Drag it all the way to CLOSE." },
    animating: { big: "Animating", sub: "The engine is fitting. Hold tight." },
    alive: { big: "It's alive!", sub: "Dispositions updated." },
    fault: { big: "Fault", sub: fault },
  }[phase];

  const campaignName = campaigns.find((c) => c.id === campaignId)?.name || "";

  return (
    <PageShell bg="/wall.png" width={620}>
      <style>{CSS}</style>

      <header style={H.header}>
        <div>
          <div style={ui.eyebrow}>The Power Room</div>
          <h1 style={ui.h1}>Animate the engine</h1>
        </div>
        <label style={H.pick}>
          <span style={ui.label}>Campaign</span>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={H.select} disabled={live}>
            {campaigns.length === 0 && <option value="">No campaigns</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </header>

      <div style={H.stage}>
        <div style={H.breakerStage}>
          <div style={{ ...H.glow, opacity: showAlive ? 1 : live ? 0.7 : 0.26 }} />
          <div
            style={{ ...H.breakerWrap, cursor: canThrow ? "grab" : "default" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="img"
            aria-label={`Breaker switch, ${seated ? "closed" : "open"}`}
          >
            {showAlive ? (
              <>
                <img src={ALIVE[0]} alt="" draggable={false} className="alive-a" style={H.layerImg} />
                <img src={ALIVE[1]} alt="" draggable={false} className="alive-b" style={H.layerImg} />
              </>
            ) : (
              <img src={FRAMES[frameIdx]} alt="" draggable={false} style={H.layerImg} />
            )}
          </div>
        </div>

        <div style={{ ...surfaces.panel, ...H.plate, borderColor: phase === "fault" ? SAX.warn : SAX.line }}>
          <div
            style={{ ...H.plateBig, color: phase === "alive" ? SAX.sun : phase === "fault" ? SAX.warn : SAX.text }}
            className={phase === "alive" ? "sax-pulse" : undefined}
          >
            {plate.big}
          </div>
          <div style={H.plateSub}>{plate.sub}</div>
          {campaignName && phase !== "fault" && <div style={{ ...ui.label, marginTop: 8, color: SAX.brass }}>{campaignName}</div>}
        </div>

        <button
          onClick={throwIt}
          disabled={!canThrow || !campaignId}
          style={{ ...ui.btnGhost, marginTop: 18, opacity: canThrow && campaignId ? 1 : 0.5, cursor: canThrow && campaignId ? "pointer" : "default" }}
        >
          {phase === "animating" ? "Animating…" : "Throw the switch"}
        </button>

        {phase === "alive" && (
          <a href="/gm/dispositions" style={H.link}>View dispositions →</a>
        )}
      </div>
    </PageShell>
  );
}

const H: Record<string, React.CSSProperties> = {
  header: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 6 },
  pick: { display: "flex", flexDirection: "column", gap: 4 },
  select: {
    background: "rgba(20,14,31,0.85)", color: SAX.text, border: `1px solid ${SAX.line}`,
    borderRadius: 8, padding: "8px 12px", fontSize: 14, minWidth: 220, fontFamily: SAX.serif,
  },
  stage: { maxWidth: 460, margin: "14px auto 0", display: "flex", flexDirection: "column", alignItems: "center" },
  breakerStage: { position: "relative", width: "100%", display: "flex", justifyContent: "center", padding: "8px 0" },
  glow: {
    position: "absolute", top: "50%", left: "50%", width: "78%", height: "70%",
    transform: "translate(-50%, -50%)", borderRadius: "50%", pointerEvents: "none",
    background: `radial-gradient(ellipse at center, ${SAX.ember} 0%, rgba(232,146,58,0.35) 35%, transparent 70%)`,
    filter: "blur(28px)", transition: "opacity 0.35s ease",
  },
  breakerWrap: { position: "relative", width: "min(340px, 84vw)", aspectRatio: "1792 / 2338", touchAction: "none", userSelect: "none" },
  layerImg: {
    position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
    userSelect: "none", pointerEvents: "none", filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.6))",
  },
  plate: { marginTop: 10, width: "100%", maxWidth: 380, textAlign: "center", padding: "16px 18px" },
  plateBig: { fontSize: 26, fontWeight: 700, letterSpacing: 0.3, fontFamily: SAX.serif },
  plateSub: { marginTop: 6, fontSize: 14, color: SAX.muted, minHeight: 20 },
  link: { marginTop: 14, color: SAX.plum, fontSize: 14, textDecoration: "none", borderBottom: `1px solid ${SAX.plum}` },
};

const CSS = `
  .alive-a, .alive-b { will-change: opacity; }
  @media (prefers-reduced-motion: no-preference) {
    .alive-a { animation: aflipA 0.22s steps(1, end) infinite; }
    .alive-b { animation: aflipB 0.22s steps(1, end) infinite; }
  }
  @keyframes aflipA { 0%, 49.9% { opacity: 1 } 50%, 100% { opacity: 0 } }
  @keyframes aflipB { 0%, 49.9% { opacity: 0 } 50%, 100% { opacity: 1 } }
  select:focus, button:focus, a:focus { outline: 2px solid ${SAX.brass}; outline-offset: 2px; }
`;
