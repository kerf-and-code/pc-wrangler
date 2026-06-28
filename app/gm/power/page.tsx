"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* Wrangler — the Power Room.
   A standalone engine-room page. The DM throws the breaker to bring the
   disposition engine to life. The switch is honest about state: it only latches
   while a fit is genuinely running, only flashes "alive" when the run row says
   done, and snaps to a fault when it errors.

   Visuals are layered: a painted base plate (breaker-base.png), an SVG handle
   drawn on top that drops onto the fuse contacts (seated) or lifts clear
   (dormant), and an arc/glow plate (breaker-alive.png) faded in while live.
   A slowly spinning Six Axes astrolabe sits above as the engine motif. */

const C = {
  bg: "#140E1F", room: "#1B1426", stone: "#241A33", stone2: "#2D2140",
  line: "#3D2F52", text: "#F4EEFA", muted: "#A597BD",
  brass: "#C8A24B", brassDim: "#7A632E", copper: "#B5763A",
  spark: "#BFE3FF", sun: "#F4C430", plum: "#9B7BD4", warn: "#E07A5F", good: "#5DBE9A",
};

/* the six disposition axes, for the upright labels around the astrolabe */
const AXES: { k: string; c: string }[] = [
  { k: "N", c: "#B7615A" },
  { k: "T", c: "#C8A24B" },
  { k: "O", c: "#4E8077" },
  { k: "S", c: "#CE8A42" },
  { k: "E", c: "#6C76B0" },
  { k: "I", c: "#9A93B0" },
];
const axisPos = (i: number) => {
  const a = ((-90 + 60 * i) * Math.PI) / 180;
  return { left: `${50 + 46 * Math.cos(a)}%`, top: `${50 + 46 * Math.sin(a)}%` };
};

type Phase = "dormant" | "arming" | "animating" | "alive" | "fault";
type Campaign = { id: string; name: string };

const PULL_PX = 200;        // drag distance for a full throw
const COMMIT = 0.8;         // fraction past which the switch latches
const OPEN_LIFT_U = 130;    // handle lift (viewBox units) when dormant

/* one copper blade arm with its forked contact tip (drawn seated) */
function Blade({ cx }: { cx: number }) {
  const x = cx - 18;
  return (
    <g>
      <rect x={x} y={206} width={36} height={300} rx={4} fill="url(#hCopper)" stroke="#1a1119" strokeWidth={2} />
      <rect x={x} y={206} width={36} height={300} rx={4} fill="url(#hHeat)" />
      <rect x={x + 4} y={210} width={5} height={292} fill="#f0c98a" opacity={0.45} />
      <rect x={cx - 26} y={490} width={13} height={34} rx={3} fill="url(#hCopper)" stroke="#1a1119" strokeWidth={2} />
      <rect x={cx + 13} y={490} width={13} height={34} rx={3} fill="url(#hCopper)" stroke="#1a1119" strokeWidth={2} />
      <rect x={cx - 26} y={488} width={52} height={14} rx={3} fill="url(#hCopper)" stroke="#1a1119" strokeWidth={2} />
    </g>
  );
}

export default function PowerRoomPage() {
  const supabase = createClient();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("dormant");
  const [pull, setPull] = useState(0);          // 0 = open (up), 1 = seated (down)
  const [fault, setFault] = useState<string>("");

  const runIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragStartY = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  /* ---- load campaigns, and resume a fit already in progress -------------- */
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
    // If a fit is already running for this campaign, latch and resume.
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
        animatePull(1);
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

  /* ---- spring/latch the handle to a target pull ------------------------- */
  const animatePull = useCallback((target: number, then?: () => void) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const step = () => {
      setPull((p) => {
        const next = p + (target - p) * 0.22;
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

  /* ---- polling the run row ---------------------------------------------- */
  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  const startPoll = () => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      const id = runIdRef.current;
      if (!id) return;
      const { data } = await supabase
        .from("disposition_runs")
        .select("status,error")
        .eq("id", id)
        .single();
      const row = data as { status: string; error: string | null } | null;
      if (!row) return;
      if (row.status === "done") {
        stopPoll();
        setPhase("alive");
        setTimeout(() => {
          animatePull(0, () => setPhase("dormant"));
        }, 3600);
      } else if (row.status === "error") {
        stopPoll();
        setFault(row.error || "The engine faulted during the fit.");
        setPhase("fault");
        animatePull(0);
      }
    }, 2500);
  };

  /* ---- throwing the switch --------------------------------------------- */
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
    const frac = Math.max(0, Math.min(1, (e.clientY - dragStartY.current) / PULL_PX));
    setPull(frac);
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

  // Keyboard / reduced-motion fallback: a plain throw.
  const throwIt = () => {
    if (!canThrow || !campaignId) return;
    setFault("");
    engage();
  };

  /* ---- derived geometry ------------------------------------------------- */
  const lift = OPEN_LIFT_U * (1 - pull);        // 0 = seated (down), max = lifted (dormant)
  const live = phase === "animating" || phase === "alive";

  const plate = {
    dormant: { big: "Dormant", sub: "Pull the switch to animate the engine." },
    arming: { big: "…", sub: "Throw it all the way down." },
    animating: { big: "Animating", sub: "The engine is fitting. Hold tight." },
    alive: { big: "It's alive!", sub: "Dispositions updated." },
    fault: { big: "Fault", sub: fault },
  }[phase];

  const campaignName = campaigns.find((c) => c.id === campaignId)?.name || "";

  return (
    <div style={S.room}>
      <style>{CSS}</style>

      <header style={S.header}>
        <div>
          <div style={S.eyebrow}>The Power Room</div>
          <h1 style={S.title}>Animate the engine</h1>
        </div>
        <label style={S.pick}>
          <span style={S.pickLabel}>Campaign</span>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            style={S.select}
            disabled={live}
          >
            {campaigns.length === 0 && <option value="">No campaigns</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </header>

      <div style={S.stage}>
        {/* Six Axes astrolabe: slow spin, faster while live; upright labels */}
        <div style={S.astroWrap} aria-hidden="true">
          <img
            src="/astrolabe.png"
            alt=""
            draggable={false}
            className={live ? "astro-disc fast" : "astro-disc"}
            style={S.astroDisc}
          />
          {AXES.map((a, i) => {
            const p = axisPos(i);
            return (
              <span key={a.k} style={{ ...S.axisLabel, color: a.c, left: p.left, top: p.top }}>
                {a.k}
              </span>
            );
          })}
        </div>

        {/* the breaker: painted base + SVG handle + arc/glow plate */}
        <div style={S.breakerWrap}>
          <img src="/breaker-base.png" alt="" draggable={false} style={S.layerImg} />

          <svg viewBox="0 0 1024 1024" style={S.handleSvg} role="img"
               aria-label="Breaker switch that starts a disposition fit">
            <defs>
              <radialGradient id="hBake" cx="40%" cy="32%" r="75%">
                <stop offset="0%" stopColor="#4a4350" />
                <stop offset="45%" stopColor="#211d28" />
                <stop offset="100%" stopColor="#0c0a10" />
              </radialGradient>
              <linearGradient id="hCopper" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#5d3a1e" />
                <stop offset="30%" stopColor="#c98a4e" />
                <stop offset="50%" stopColor="#e6ad6a" />
                <stop offset="70%" stopColor="#a86a35" />
                <stop offset="100%" stopColor="#4f3219" />
              </linearGradient>
              <linearGradient id="hBrass" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6e571f" />
                <stop offset="45%" stopColor="#d9bd63" />
                <stop offset="60%" stopColor="#e8d27e" />
                <stop offset="100%" stopColor="#5f4b1a" />
              </linearGradient>
              <linearGradient id="hIron" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3a3543" />
                <stop offset="50%" stopColor="#211e28" />
                <stop offset="100%" stopColor="#100e15" />
              </linearGradient>
              <linearGradient id="hHeat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6f86a0" stopOpacity={0} />
                <stop offset="50%" stopColor="#7f93a6" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#6f86a0" stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* moving assembly: crossbar, two blades, neck, pivot boss, ball */}
            <g transform={`translate(0 ${-lift})`}>
              <rect x={328} y={194} width={368} height={28} rx={10} fill="url(#hIron)" stroke="#0c0a10" strokeWidth={2} />
              <rect x={334} y={198} width={356} height={6} rx={3} fill="#534e5e" opacity={0.7} />
              <Blade cx={358} />
              <Blade cx={662} />
              <rect x={500} y={124} width={24} height={60} rx={6} fill="url(#hBake)" stroke="#0c0a10" strokeWidth={2} />
              <circle cx={512} cy={180} r={25} fill="url(#hBrass)" stroke="#0c0a10" strokeWidth={2} />
              <circle cx={512} cy={180} r={7} fill="#3a2f12" />
              <circle cx={512} cy={96} r={47} fill="url(#hBake)" stroke="#0c0a10" strokeWidth={2} />
              <ellipse cx={497} cy={79} rx={16} ry={11} fill="#6f6878" opacity={0.6} />

              {/* drag target (larger than the ball, for easy grabbing) */}
              <circle
                cx={512} cy={96} r={90} fill="transparent"
                onPointerDown={onDown} onPointerMove={onMove}
                onPointerUp={onUp} onPointerCancel={onUp}
                style={{ pointerEvents: "all", cursor: canThrow ? "grab" : "default", touchAction: "none" }}
              />
            </g>

            {/* throw-progress hint while arming */}
            {phase === "arming" && (
              <g>
                <rect x={764} y={230} width={16} height={280} rx={8} fill="#0c0814" />
                <rect x={764} y={230 + 280 * (1 - pull)} width={16} height={280 * pull} rx={8}
                      fill={pull >= COMMIT ? C.good : C.sun} />
              </g>
            )}
          </svg>

          <img
            src="/breaker-alive.png"
            alt=""
            draggable={false}
            className={live ? "alive-on" : undefined}
            style={{ ...S.layerImg, opacity: live ? 1 : 0, transition: "opacity 0.3s ease" }}
          />
        </div>

        {/* status plate */}
        <div style={{ ...S.plate, borderColor: phase === "fault" ? C.warn : C.line }}>
          <div style={{
            ...S.plateBig,
            color: phase === "alive" ? C.sun : phase === "fault" ? C.warn : C.text,
          }} className={phase === "alive" ? "alivePulse" : undefined}>
            {plate.big}
          </div>
          <div style={S.plateSub}>{plate.sub}</div>
          {campaignName && phase !== "fault" && (
            <div style={S.plateMeta}>{campaignName}</div>
          )}
        </div>

        {/* accessible / keyboard throw */}
        <button onClick={throwIt} disabled={!canThrow || !campaignId} style={{
          ...S.throwBtn,
          opacity: canThrow && campaignId ? 1 : 0.5,
          cursor: canThrow && campaignId ? "pointer" : "default",
        }}>
          {phase === "animating" ? "Animating…" : "Throw the switch"}
        </button>

        {phase === "alive" && (
          <a href="/gm/dispositions" style={S.link}>View dispositions →</a>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
const S: Record<string, React.CSSProperties> = {
  room: {
    minHeight: "100dvh", background: `radial-gradient(circle at 50% 30%, ${C.room}, ${C.bg})`,
    color: C.text, padding: "28px 20px 60px",
    fontFamily: "'Iowan Old Style', Georgia, serif",
  },
  header: {
    maxWidth: 760, margin: "0 auto 8px", display: "flex",
    alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
  },
  eyebrow: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: C.brass,
  },
  title: { margin: "4px 0 0", fontSize: 30, fontWeight: 600, letterSpacing: 0.2 },
  pick: { display: "flex", flexDirection: "column", gap: 4 },
  pickLabel: {
    fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: 2,
    textTransform: "uppercase", color: C.muted,
  },
  select: {
    background: C.stone, color: C.text, border: `1px solid ${C.line}`,
    borderRadius: 8, padding: "8px 12px", fontSize: 14, minWidth: 220,
    fontFamily: "'Iowan Old Style', Georgia, serif",
  },
  stage: { maxWidth: 460, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center" },

  astroWrap: { position: "relative", width: 150, height: 150, margin: "6px auto 34px", flex: "none" },
  astroDisc: { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.9 },
  axisLabel: {
    position: "absolute", transform: "translate(-50%, -50%)",
    fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1,
    lineHeight: 1, padding: "1px 5px", borderRadius: 6,
    background: "rgba(20,14,31,0.78)", border: "1px solid rgba(61,47,82,0.85)",
  },

  breakerWrap: {
    position: "relative", width: "min(330px, 80vw)", aspectRatio: "1 / 1",
    margin: "0 auto", overflow: "visible", touchAction: "none", userSelect: "none",
  },
  layerImg: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    objectFit: "contain", userSelect: "none", pointerEvents: "none",
  },
  handleSvg: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    overflow: "visible", pointerEvents: "none",
  },

  plate: {
    marginTop: 14, width: "100%", maxWidth: 380, textAlign: "center",
    background: C.stone, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px",
  },
  plateBig: { fontSize: 26, fontWeight: 700, letterSpacing: 0.3 },
  plateSub: { marginTop: 6, fontSize: 14, color: C.muted, minHeight: 20 },
  plateMeta: {
    marginTop: 8, fontFamily: "ui-monospace, monospace", fontSize: 11,
    letterSpacing: 1.5, textTransform: "uppercase", color: C.brass,
  },
  throwBtn: {
    marginTop: 18, background: "transparent", color: C.brass,
    border: `1px solid ${C.brass}`, borderRadius: 999, padding: "10px 22px",
    fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  link: { marginTop: 14, color: C.plum, fontSize: 14, textDecoration: "none", borderBottom: `1px solid ${C.plum}` },
};

const CSS = `
  @media (prefers-reduced-motion: no-preference) {
    .astro-disc { animation: spin 70s linear infinite; transform-origin: 50% 50%; }
    .astro-disc.fast { animation: spin 9s linear infinite; }
    .alive-on { animation: flicker 1.4s ease-in-out infinite; }
    .alivePulse { animation: alive 0.5s ease-out 3; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes flicker { 0%,100%{opacity:.8} 45%{opacity:1} 60%{opacity:.62} 78%{opacity:.96} }
  @keyframes alive { 0%{transform:scale(1)} 40%{transform:scale(1.12)} 100%{transform:scale(1)} }
  select:focus, button:focus, a:focus { outline: 2px solid ${C.brass}; outline-offset: 2px; }
`;
