"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// lib/compendium/useVosk.ts
//
// On-device speech recognition for the compendium, using vosk-browser (Kaldi WASM in a worker). It is
// dynamically imported the first time the mic is used, so it never runs during SSR or the production
// build. The model (~40MB .tar.gz) is served statically and fetched once, then cached by the browser.
//
// Audio path is the documented vosk-browser one: getUserMedia -> AudioContext -> ScriptProcessorNode
// -> recognizer.acceptWaveform(inputBuffer). ScriptProcessorNode is deprecated but works everywhere
// with no extra worklet asset to ship, which matters for a tool that must "just run" at a table.
//
// Grammar is optional. Passing the compendium's phrase list constrains recognition to our vocabulary
// (better on odd names) but every grammar word must be in the model's lexicon or the recognizer can
// reject it, so we try WITH grammar and fall back to free recognition if construction throws. Free
// recognition plus the fuzzy matcher is the safe default; grammar is an opt-in tuning lever.

export type VoskStatus = "idle" | "loading" | "ready" | "listening" | "error";

interface KRecognizer {
  on(event: "result", cb: (m: { result?: { text?: string } }) => void): void;
  on(event: "partialresult", cb: (m: { result?: { partial?: string } }) => void): void;
  acceptWaveform(buffer: AudioBuffer): void;
  remove?(): void;
}
interface VModel {
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => KRecognizer;
  terminate?(): void;
}
interface VoskLib { createModel(url: string): Promise<VModel> }

export interface UseVoskOptions {
  modelUrl: string;
  onText: (text: string) => void;
  onPartial?: (text: string) => void;
  grammar?: string[] | null;
}

export interface UseVosk {
  status: VoskStatus;
  error: string | null;
  listening: boolean;
  supported: boolean;
  ensureModel: () => Promise<boolean>;
  start: () => Promise<void>;
  stop: () => void;
}

type AudioCtor = typeof AudioContext;

export function useVosk(opts: UseVoskOptions): UseVosk {
  const [status, setStatus] = useState<VoskStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);

  const modelRef = useRef<VModel | null>(null);
  const recRef = useRef<KRecognizer | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);

  const onTextRef = useRef(opts.onText);
  const onPartialRef = useRef(opts.onPartial);
  const grammarRef = useRef(opts.grammar);
  const modelUrlRef = useRef(opts.modelUrl);
  onTextRef.current = opts.onText;
  onPartialRef.current = opts.onPartial;
  grammarRef.current = opts.grammar;
  modelUrlRef.current = opts.modelUrl;

  const supported = typeof window !== "undefined"
    && !!navigator?.mediaDevices?.getUserMedia
    && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);

  const ensureModel = useCallback(async (): Promise<boolean> => {
    if (modelRef.current) return true;
    setStatus("loading"); setError(null);
    try {
      const vosk = (await import("vosk-browser")) as unknown as VoskLib;
      modelRef.current = await vosk.createModel(modelUrlRef.current);
      setStatus("ready");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the speech model.");
      setStatus("error");
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    try { procRef.current?.disconnect(); } catch { /* ignore */ }
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void ctxRef.current?.close(); } catch { /* ignore */ }
    try { recRef.current?.remove?.(); } catch { /* ignore */ }
    procRef.current = null; sourceRef.current = null; streamRef.current = null; ctxRef.current = null; recRef.current = null;
    setListening(false);
    setStatus((s) => (s === "error" ? s : "ready"));
  }, []);

  const start = useCallback(async () => {
    if (listening) return;
    if (!supported) { setError("This browser can't capture the microphone."); setStatus("error"); return; }
    const ok = await ensureModel();
    if (!ok || !modelRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext);
      const ctx = new Ctor();
      ctxRef.current = ctx;

      // Build the recognizer, trying the grammar first and falling back to free recognition.
      let rec: KRecognizer;
      const g = grammarRef.current;
      try {
        rec = g && g.length
          ? new modelRef.current.KaldiRecognizer(ctx.sampleRate, JSON.stringify(g))
          : new modelRef.current.KaldiRecognizer(ctx.sampleRate);
      } catch {
        rec = new modelRef.current.KaldiRecognizer(ctx.sampleRate);
      }
      recRef.current = rec;
      rec.on("result", (m) => { const t = m.result?.text?.trim(); if (t) onTextRef.current(t); });
      rec.on("partialresult", (m) => { const t = m.result?.partial?.trim(); if (t) onPartialRef.current?.(t); });

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      proc.onaudioprocess = (ev) => { try { rec.acceptWaveform(ev.inputBuffer); } catch { /* frame drop is fine */ } };
      source.connect(proc);
      proc.connect(ctx.destination); // required in some browsers for onaudioprocess to fire

      setListening(true);
      setStatus("listening");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone access was blocked.");
      setStatus("error");
      stop();
    }
  }, [listening, supported, ensureModel, stop]);

  useEffect(() => () => stop(), [stop]);

  return { status, error, listening, supported, ensureModel, start, stop };
}
