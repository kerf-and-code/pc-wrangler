"use client";

// components/class-quiz.tsx (2026-11-07)
//
// The free, no-login "What D&D class should I be?" quiz (/tools/dnd-class-quiz). A React port of the
// standalone quiz Terry supplied: the same questions, the same tag-built class branches, the same
// edition and publisher filters, the funnel gauge, runners-up and the full flowchart. The logic lives in
// lib/tools/class-quiz.ts; this file only draws it. Nothing is stored.
//
// Register: the marketing site's night palette (the --sn-* variables ToolsShell sets), so it sits with
// the other tools. Keys 1 to 9 answer, Backspace goes back.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CLASSES, SOURCES, SUBCLASSES } from "@/lib/tools/class-quiz-data";
import {
  BY_ID, CLASS_ORDER, ROLE_LABEL, back as stepBack, choose as stepChoose, className, currentOf,
  editionLabel, isPartner, makeQuiz, publisherLabel, runnersUp, settle, type Filters, type Quiz, type Step,
} from "@/lib/tools/class-quiz";

export default function ClassQuiz() {
  const [filters, setFilters] = useState<Filters>({ legacy: true, partner: true });
  const quiz = useMemo(() => makeQuiz(filters), [filters]);
  const [stack, setStack] = useState<Step[]>(() => settle(makeQuiz({ legacy: true, partner: true }), []));
  const [mapOpen, setMapOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const [toast, setToast] = useState("");
  const headRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const cur = currentOf(stack);
  const done = cur.startsWith("r:");

  // After an answer, bring the new question to the keyboard and into view (not on first load).
  useEffect(() => {
    if (!moved.current) return;
    headRef.current?.focus({ preventScroll: true });
    const top = cardRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0 || top > window.innerHeight * 0.6) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [stack]);

  const go = useCallback((next: Step[]) => { moved.current = true; setStack(next); setToast(""); }, []);
  const choose = useCallback((i: number) => go(stepChoose(quiz, stack, i)), [go, quiz, stack]);
  const goBack = useCallback(() => go(stepBack(stack)), [go, stack]);
  const restart = useCallback(() => go(settle(quiz, [])), [go, quiz]);

  function setFilter(next: Filters) {
    setFilters(next);
    moved.current = false;
    setStack(settle(makeQuiz(next), []));
    setToast("");
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9 && !done) { e.preventDefault(); choose(n - 1); }
      else if (e.key === "Backspace" && stack.length) { e.preventDefault(); goBack(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, goBack, done, stack.length]);

  // The gauge: how many heroes are still possible from here.
  const total = quiz.reach("start").length;
  const remaining = done ? [cur.slice(2)] : quiz.reach(cur);
  const liveClasses = [...new Set(remaining.map((id) => BY_ID[id].c))];
  const realAnswers = stack.filter((s) => !s.auto).length;

  async function copyResult(id: string) {
    const r = BY_ID[id];
    const txt = `${r.n} (${className(r.c)}), ${SOURCES[r.s].name}. ${r.b}\nPath: ${stack.map((s) => s.text).join(" > ")}`;
    try { await navigator.clipboard.writeText(txt); setToast("Copied."); }
    catch { setToast("Your browser blocked copying here."); }
  }

  return (
    <div className="cq">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="cq-filters">
        <div className="cq-seg" role="group" aria-label="Rules edition">
          <button type="button" aria-pressed={!filters.legacy} onClick={() => setFilter({ ...filters, legacy: false })}>2024 rules only</button>
          <button type="button" aria-pressed={filters.legacy} onClick={() => setFilter({ ...filters, legacy: true })}>Include 2014</button>
        </div>
        <div className="cq-seg" role="group" aria-label="Publishers">
          <button type="button" aria-pressed={!filters.partner} onClick={() => setFilter({ ...filters, partner: false })}>Official only</button>
          <button type="button" aria-pressed={filters.partner} onClick={() => setFilter({ ...filters, partner: true })}>Include partnered</button>
        </div>
      </div>

      <section className="cq-gauge" aria-live="polite">
        <div className="cq-num">{remaining.length}</div>
        <div>
          <div className="cq-lbl">{remaining.length === 1 ? "hero found" : `possible heroes remain, out of ${total}`}</div>
          <div className="cq-bar"><i style={{ width: `${Math.max(1.5, (remaining.length / Math.max(1, total)) * 100)}%` }} /></div>
        </div>
        <button type="button" className="cq-chip" aria-pressed={peek} onClick={() => setPeek(!peek)}>Peek</button>
        {peek && (
          <div className="cq-pips">
            <span className="cq-pip">{liveClasses.length} class{liveClasses.length === 1 ? "" : "es"} left</span>
            {liveClasses.map((k) => <span key={k} className="cq-pip">{className(k)}</span>)}
          </div>
        )}
      </section>

      <div ref={cardRef} className="cq-card">
        {done
          ? <Result id={cur.slice(2)} quiz={quiz} stack={stack} headRef={headRef}
              onAlt={(alt) => go([...stack, { node: "alt", text: `Peeked at ${BY_ID[alt].n}`, to: "r:" + alt, auto: false }])}
              onBack={goBack} onRestart={restart} mapOpen={mapOpen}
              onMap={() => setMapOpen(!mapOpen)} onCopy={() => copyResult(cur.slice(2))} toast={toast} />
          : <Question id={cur} quiz={quiz} stack={stack} number={realAnswers + 1} headRef={headRef}
              onChoose={choose} onBack={goBack} onRestart={restart} />}
      </div>

      {mapOpen && <Flowchart quiz={quiz} stack={stack} />}

      <p className="cq-foot">
        {SUBCLASSES.length} subclasses across {CLASS_ORDER.length} classes, from the official books and the D&amp;D Beyond
        partnered publishers. Every description is written for this quiz; see the source book for the actual rules.
        Unofficial: Six Axes is not affiliated with Wizards of the Coast or any publisher named here.
      </p>
    </div>
  );
}

function Question({ id, quiz, stack, number, headRef, onChoose, onBack, onRestart }: {
  id: string; quiz: Quiz; stack: Step[]; number: number; headRef: React.RefObject<HTMLHeadingElement | null>;
  onChoose: (i: number) => void; onBack: () => void; onRestart: () => void;
}) {
  const n = quiz.getNode(id);
  const opts = quiz.visible(id);
  return (
    <>
      <div className="cq-step">Question {number}</div>
      <h2 className="cq-q" ref={headRef} tabIndex={-1}>{n.q}</h2>
      {n.s && <p className="cq-qsub">{n.s}</p>}
      <div className="cq-opts">
        {opts.map((o, i) => {
          const ids = quiz.reach(o[2]);
          let tag: ReactNode = null;
          if (!n.final) {
            if (ids.every((x) => isPartner(BY_ID[x]))) tag = <em className="cq-tag is-partner">partnered</em>;
            else if (ids.every((x) => BY_ID[x].e === "L" || BY_ID[x].e === "14")) tag = <em className="cq-tag">2014</em>;
          }
          return (
            <button key={o[2]} type="button" className="cq-opt" onClick={() => onChoose(i)}>
              {i < 9 && <span className="cq-key" aria-hidden>{i + 1}</span>}
              <span className="cq-optbody">
                <b>{o[0]}</b>
                {o[1] && <span>{o[1]}</span>}
                {tag}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cq-row">
        <button type="button" className="cq-btn" onClick={onBack} disabled={!stack.some((s) => !s.auto)}>Back</button>
        {stack.length > 0 && <button type="button" className="cq-btn" onClick={onRestart}>Start over</button>}
        <span className="cq-hint">Keys 1 to 9 answer, Backspace goes back</span>
      </div>
      <Trail stack={stack} />
    </>
  );
}

function Result({ id, quiz, stack, headRef, onAlt, onBack, onRestart, mapOpen, onMap, onCopy, toast }: {
  id: string; quiz: Quiz; stack: Step[]; headRef: React.RefObject<HTMLHeadingElement | null>;
  onAlt: (id: string) => void; onBack: () => void; onRestart: () => void;
  mapOpen: boolean; onMap: () => void; onCopy: () => void; toast: string;
}) {
  const r = BY_ID[id];
  const c = CLASSES[r.c];
  const alts = runnersUp(quiz, stack, id);
  return (
    <>
      <div className="cq-step">Your hero</div>
      <div>
        <h2 className="cq-res" ref={headRef} tabIndex={-1}>{r.n}</h2>
        <div className="cq-cls">{c.name}</div>
      </div>
      <p className="cq-blurb">{r.b}</p>
      <div className="cq-facts">
        <Fact k="Plays as" v={r.r.map((x) => ROLE_LABEL[x]).join(", ")} />
        {c.abilities && <Fact k="Key abilities" v={c.abilities} />}
        {c.hitDie && <Fact k="Hit die" v={c.hitDie} />}
        {c.complexity && <Fact k="Class complexity" v={c.complexity} />}
        <Fact k="Source" v={SOURCES[r.s].name} />
        <Fact k="Publisher" v={publisherLabel(r)} />
        <Fact k="Rules" v={editionLabel(r)} />
      </div>
      <h3 className="cq-h3">About the {c.name}</h3>
      <p className="cq-dim">{c.blurb}</p>
      {alts.length > 0 && (
        <>
          <h3 className="cq-h3">Close runners-up</h3>
          <div className="cq-alts">
            {alts.map((a) => (
              <button key={a} type="button" className="cq-alt" onClick={() => onAlt(a)}>
                {BY_ID[a].n}{BY_ID[a].c !== r.c ? ` (${className(BY_ID[a].c)})` : ""}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="cq-row">
        <button type="button" className="cq-btn" onClick={onBack}>Back</button>
        <button type="button" className="cq-btn" onClick={onRestart}>Start over</button>
        <button type="button" className="cq-btn is-primary" onClick={onMap}>{mapOpen ? "Hide the flowchart" : "Show the whole flowchart"}</button>
        <button type="button" className="cq-btn" onClick={onCopy}>Copy result</button>
        <span className="cq-toast" role="status">{toast}</span>
      </div>
      <h3 className="cq-h3">How you got here</h3>
      <Trail stack={stack} />
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <div className="cq-fact"><small>{k}</small>{v}</div>;
}

function Trail({ stack }: { stack: Step[] }) {
  if (!stack.length) return null;
  return (
    <div className="cq-trail" aria-label="Your answers so far">
      {stack.map((s, i) => (
        <div key={i} className={s.auto ? "is-auto" : undefined}>{s.text}{s.auto ? " (the only path left)" : ""}</div>
      ))}
    </div>
  );
}

// Every question that could have been asked, with the visitor's own path highlighted. The opening funnel
// first, then one collapsible branch per class.
function Flowchart({ quiz, stack }: { quiz: Quiz; stack: Step[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const keys = new Set(stack.map((s) => s.node + "|" + s.text));
  const seen = new Set<string>();

  function nodeTree(id: string, inClass: boolean): ReactNode {
    seen.add(id);
    const n = quiz.getNode(id);
    const live = n.o.filter((o) => quiz.reach(o[2]).length);
    if (live.length === 1 && live[0][2].startsWith("r:")) {
      return <span className="cq-resl"> → {BY_ID[live[0][2].slice(2)].n}</span>;
    }
    return (
      <ul><li><span className="cq-nq">{n.q}</span>
        <ul>{live.map((o) => {
          const hit = keys.has(id + "|" + o[0]);
          const t = o[2];
          let tail: ReactNode;
          if (t.startsWith("r:")) {
            const r = BY_ID[t.slice(2)];
            tail = <>
              <span className="cq-resl"> → {r.n}{inClass ? "" : ` (${className(r.c)})`}</span>
              {isPartner(r) ? <span className="cq-lg">partnered</span> : r.e === "L" ? <span className="cq-lg">2014</span> : null}
            </>;
          } else if (t.startsWith("c:") && !inClass && !t.includes("~")) {
            const k = t.slice(2);
            tail = <>{" "}<a href={`#cq-br-${k}`} className="cq-jump" onClick={() => setOpen((s) => ({ ...s, [k]: true }))}>→ {className(k)} branch</a></>;
          } else if (seen.has(t)) {
            tail = <span className="cq-jump"> → back up to: {quiz.getNode(t).q}</span>;
          } else {
            tail = nodeTree(t, inClass);
          }
          return <li key={t} className={hit ? "is-hit" : undefined}><span className="cq-no">{o[0]}</span>{tail}</li>;
        })}</ul>
      </li></ul>
    );
  }

  return (
    <section className="cq-card cq-map">
      <h3 className="cq-h3">The whole flowchart</h3>
      <p className="cq-dim">Every question you could have been asked, and where each answer leads. Your path is highlighted.</p>
      <div className="cq-tree">
        <h4 className="cq-h4">The opening questions</h4>
        {nodeTree("start", false)}
        {CLASS_ORDER.map((k) => {
          const count = quiz.reach("c:" + k).length;
          if (!count) return null;
          const onPath = stack.some((s) => s.node === "c:" + k || s.node.startsWith("c:" + k + "~"));
          return (
            <details key={k} id={`cq-br-${k}`} className="cq-branch" open={open[k] ?? onPath}
              onToggle={(e) => { const el = e.currentTarget; setOpen((s) => (s[k] === el.open ? s : { ...s, [k]: el.open })); }}>
              <summary>{className(k)} ({count} option{count === 1 ? "" : "s"})</summary>
              {nodeTree("c:" + k, true)}
            </details>
          );
        })}
      </div>
    </section>
  );
}

const CSS = `
.cq { display: flex; flex-direction: column; gap: 18px; }
.cq-filters { display: flex; flex-wrap: wrap; gap: 10px 16px; }
.cq-seg { display: inline-flex; border: 1px solid var(--sn-line2); border-radius: 999px; padding: 3px; background: var(--sn-bg2); }
.cq-seg button { font: inherit; font-size: 15px; min-height: 40px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--sn-dim); cursor: pointer; }
.cq-seg button[aria-pressed="true"] { background: var(--sn-card); color: var(--sn-ink); box-shadow: inset 0 0 0 1px var(--sn-line); }
.cq-gauge { display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center; background: var(--sn-card); border: 1px solid var(--sn-line2); border-radius: 10px; padding: 14px 18px; }
.cq-num { font-family: var(--sn-display); font-weight: 800; font-size: 36px; color: var(--sn-amber-hi); font-variant-numeric: tabular-nums; min-width: 2.6ch; text-align: right; line-height: 1; }
.cq-lbl { font-size: 15px; color: var(--sn-dim); margin-bottom: 6px; }
.cq-bar { height: 8px; background: var(--sn-bg); border-radius: 4px; overflow: hidden; }
.cq-bar i { display: block; height: 100%; background: var(--sn-amber); transition: width .4s ease; }
.cq-chip { font: inherit; font-size: 15px; min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--sn-line2); background: transparent; color: var(--sn-dim); cursor: pointer; }
.cq-chip[aria-pressed="true"] { border-color: var(--sn-amber); color: var(--sn-ink); }
.cq-pips { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.cq-pip { font-size: 13px; padding: 2px 8px; border-radius: 4px; border: 1px solid var(--sn-line2); color: var(--sn-ink); }
.cq-card { background: var(--sn-card); border: 1px solid var(--sn-line2); border-radius: 12px; padding: 26px 26px; display: flex; flex-direction: column; gap: 16px; scroll-margin-top: 90px; }
.cq-step { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--sn-amber-hi); font-weight: 700; }
.cq-q { font-family: var(--sn-display); font-weight: 700; font-size: 32px; line-height: 1.15; color: var(--sn-ink); margin: 0; outline: none; }
.cq .cq-qsub { color: var(--sn-dim); margin: -6px 0 0; font-style: italic; }
.cq-opts { display: flex; flex-direction: column; gap: 10px; }
.cq-opt { font: inherit; text-align: left; cursor: pointer; background: var(--sn-bg2); color: var(--sn-ink); border: 1px solid var(--sn-line2); border-radius: 8px; padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start; min-height: 48px; transition: border-color .15s, background .15s; }
.cq-opt:hover { border-color: var(--sn-amber); background: #1f2633; }
.cq-key { flex: none; width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--sn-line2); color: var(--sn-faint); font-size: 13px; display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
.cq-optbody { display: flex; flex-direction: column; gap: 2px; }
.cq-optbody b { font-weight: 600; font-size: 17px; }
.cq-optbody > span { font-size: 15px; color: var(--sn-dim); }
.cq-tag { align-self: flex-start; margin-top: 4px; font-size: 12px; font-style: normal; color: var(--sn-dim); border: 1px solid var(--sn-line2); border-radius: 4px; padding: 0 6px; }
.cq-tag.is-partner { color: #8fc7bd; border-color: rgba(143,199,189,0.4); }
.cq-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.cq-btn { font: inherit; font-size: 15px; font-weight: 600; min-height: 44px; padding: 0 16px; border-radius: 8px; border: 1.5px solid rgba(232,228,218,0.35); background: transparent; color: var(--sn-ink); cursor: pointer; }
.cq-btn:hover:not(:disabled) { border-color: var(--sn-ink); }
.cq-btn.is-primary { background: var(--sn-amber); border-color: var(--sn-amber); color: var(--sn-amber-ink); }
.cq-btn.is-primary:hover { background: var(--sn-amber-hi); border-color: var(--sn-amber-hi); }
.cq-btn:disabled { opacity: .4; cursor: default; }
.cq-hint { font-size: 14px; color: var(--sn-faint); margin-left: auto; }
.cq-toast { font-size: 15px; color: var(--sn-amber-hi); }
.cq-trail { display: flex; flex-direction: column; gap: 4px; font-size: 15px; color: var(--sn-dim); border-left: 2px solid var(--sn-line2); padding-left: 12px; }
.cq-trail div::before { content: "\\25B8  "; color: var(--sn-amber); }
.cq-trail .is-auto { opacity: .7; font-style: italic; }
.cq-res { font-family: var(--sn-display); font-weight: 800; font-size: 44px; line-height: 1.05; color: var(--sn-amber-hi); margin: 0; outline: none; }
.cq-cls { font-family: var(--sn-display); font-size: 22px; color: var(--sn-ink); font-style: italic; }
.cq .cq-blurb { font-size: 18px; color: var(--sn-ink); margin: 0; }
.cq .cq-dim { color: var(--sn-dim); margin: 0; }
.cq-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.cq-fact { background: var(--sn-bg2); border-radius: 8px; padding: 9px 12px; font-size: 15px; color: var(--sn-ink); }
.cq-fact small { display: block; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--sn-faint); margin-bottom: 2px; }
.cq-h3 { font-family: var(--sn-display); font-weight: 700; font-size: 22px; color: var(--sn-ink); margin: 6px 0 0; }
.cq-h4 { font-family: var(--sn-display); font-weight: 700; font-size: 19px; color: var(--sn-ink); margin: 0 0 4px; }
.cq-alts { display: flex; flex-wrap: wrap; gap: 8px; }
.cq-alt { font: inherit; font-size: 15px; min-height: 40px; padding: 0 12px; border-radius: 6px; border: 1px dashed var(--sn-line2); background: transparent; color: var(--sn-ink); cursor: pointer; }
.cq-alt:hover { border-color: var(--sn-amber); }
.cq-tree { font-size: 15px; }
.cq-tree ul { list-style: none; margin: 0; padding-left: 16px; border-left: 1px solid var(--sn-line2); }
.cq-tree > ul { padding-left: 0; border-left: 0; }
.cq-tree li { margin: 4px 0; max-width: none; font-size: 15px; line-height: 1.5; }
.cq-nq { color: var(--sn-ink); font-style: italic; }
.cq-no { color: var(--sn-dim); }
.cq-tree li.is-hit > .cq-no { color: var(--sn-amber-hi); font-weight: 700; }
.cq-resl { color: var(--sn-ink); }
.cq-lg { margin-left: 6px; font-size: 12px; color: var(--sn-faint); border: 1px solid var(--sn-line2); border-radius: 4px; padding: 0 5px; }
.cq-jump { color: var(--sn-amber-hi); }
.cq-branch { margin-top: 10px; border-top: 1px solid var(--sn-line2); padding-top: 10px; scroll-margin-top: 90px; }
.cq-branch summary { cursor: pointer; font-weight: 600; color: var(--sn-ink); min-height: 32px; }
.cq .cq-foot { font-size: 14px; color: var(--sn-faint); margin: 0; max-width: none; }
@media (max-width: 600px) {
  .cq-card { padding: 20px 16px; }
  .cq-q { font-size: 26px; }
  .cq-res { font-size: 34px; }
  .cq-hint { display: none; }
  .cq-gauge { grid-template-columns: auto 1fr; }
  .cq-gauge .cq-chip { grid-column: 1 / -1; justify-self: start; }
}
@media (prefers-reduced-motion: reduce) { .cq-bar i { transition: none; } }
`;
