"use client";

import type { SoundPatch } from "@web-kits/audio";
import { SoundProvider, usePatch } from "@web-kits/audio/react";
import { Volume2, VolumeX } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Interface sounds (Web Audio, synthesized — no assets). Two layers:
 * 1. a document-level listener classifies clicks by shadcn `data-slot` / role (tap, select, open/close, toggle, destructive)
 * 2. `useSound()` for outcome cues code decides on: success (approval, scan done), error, warning, notification, command
 * Muted state persists in localStorage; respects prefers-reduced-motion by defaulting to muted there.
 */

const STORAGE_KEY = "ac-sound-muted";
const VOLUME = 0.45;

const PATCH = {
  name: "aftercircular-ui",
  sounds: {
    tap: { source: { type: "sine", frequency: 1300, fm: { ratio: 0.5, depth: 100 } }, envelope: { attack: 0, decay: 0.015, sustain: 0, release: 0.005 }, gain: 0.2 },
    select: { source: { type: "triangle", frequency: { start: 900, end: 780 } }, envelope: { attack: 0.001, decay: 0.055 }, gain: 0.26 },
    toggleOn: { source: { type: "sine", frequency: { start: 520, end: 880 } }, envelope: { attack: 0.002, decay: 0.085 }, gain: 0.3 },
    toggleOff: { source: { type: "sine", frequency: { start: 780, end: 420 } }, envelope: { attack: 0.002, decay: 0.085 }, gain: 0.28 },
    open: { source: { type: "triangle", frequency: { start: 320, end: 620 } }, filter: { type: "lowpass", frequency: 2600 }, envelope: { attack: 0.006, decay: 0.13 }, gain: 0.24 },
    close: { source: { type: "triangle", frequency: { start: 560, end: 300 } }, filter: { type: "lowpass", frequency: 2200 }, envelope: { attack: 0.004, decay: 0.11 }, gain: 0.22 },
    tick: { source: { type: "square", frequency: 1400 }, filter: { type: "lowpass", frequency: 3000 }, envelope: { decay: 0.014 }, gain: 0.1 },
    destructive: {
      layers: [
        { source: { type: "triangle", frequency: { start: 300, end: 170 } }, filter: { type: "lowpass", frequency: 1400 }, envelope: { attack: 0.002, decay: 0.12 }, gain: 0.32 },
        { source: { type: "noise", color: "brown" }, filter: { type: "bandpass", frequency: 700, resonance: 1.1 }, envelope: { decay: 0.05 }, gain: 0.06 },
      ],
    },
    success: {
      layers: [
        { source: { type: "triangle", frequency: 784 }, envelope: { attack: 0.004, decay: 0.16 }, gain: 0.22 },
        { source: { type: "triangle", frequency: 1175 }, envelope: { attack: 0.004, decay: 0.22 }, gain: 0.18, delay: 0.075 },
      ],
    },
    error: {
      layers: [
        { source: { type: "triangle", frequency: 300 }, filter: { type: "lowpass", frequency: 1200 }, envelope: { attack: 0.003, decay: 0.13 }, gain: 0.26 },
        { source: { type: "triangle", frequency: 224 }, filter: { type: "lowpass", frequency: 1000 }, envelope: { attack: 0.003, decay: 0.2 }, gain: 0.24, delay: 0.09 },
      ],
    },
    warning: {
      layers: [
        { source: { type: "triangle", frequency: 622 }, filter: { type: "lowpass", frequency: 2800 }, envelope: { attack: 0.003, decay: 0.14 }, gain: 0.2 },
        { source: { type: "triangle", frequency: 622 }, filter: { type: "lowpass", frequency: 2800 }, envelope: { attack: 0.003, decay: 0.18 }, gain: 0.17, delay: 0.085 },
      ],
    },
    copy: {
      layers: [
        { source: { type: "sine", frequency: 1200 }, envelope: { attack: 0, decay: 0.015, sustain: 0, release: 0.006 }, gain: 0.16 },
        { source: { type: "sine", frequency: 1400 }, envelope: { attack: 0, decay: 0.015, sustain: 0, release: 0.006 }, delay: 0.04, gain: 0.14 },
      ],
    },
    notification: {
      layers: [
        { source: { type: "triangle", frequency: 523 }, envelope: { attack: 0.008, decay: 0.3, sustain: 0.03, release: 0.12 }, gain: 0.14 },
        { source: { type: "triangle", frequency: 784 }, envelope: { attack: 0.008, decay: 0.25, sustain: 0.02, release: 0.1 }, delay: 0.12, gain: 0.12 },
      ],
    },
    swoosh: { source: { type: "sine", frequency: { start: 300, end: 2000 } }, envelope: { attack: 0.008, decay: 0.12, sustain: 0, release: 0.04 }, gain: 0.12 },
    chirp: { source: { type: "sine", frequency: { start: 1200, end: 1500 } }, envelope: { attack: 0, decay: 0.03, sustain: 0, release: 0.01 }, gain: 0.08 },
    command: {
      layers: [
        { source: { type: "triangle", frequency: { start: 1046, end: 784 } }, envelope: { attack: 0.001, decay: 0.075 }, gain: 0.2 },
        { source: { type: "sine", frequency: 1568 }, envelope: { attack: 0.001, decay: 0.045 }, gain: 0.06, delay: 0.018 },
      ],
    },
    blocked: { source: { type: "sine", frequency: 180 }, filter: { type: "lowpass", frequency: 700 }, envelope: { attack: 0.004, decay: 0.06 }, gain: 0.16 },
  },
} as const satisfies SoundPatch;

export type SoundName = keyof (typeof PATCH)["sounds"];
type Cue = { sound: SoundName; detune?: number; velocity?: number };

const JITTER: Record<SoundName, number> = { tap: 26, select: 22, toggleOn: 14, toggleOff: 14, open: 10, close: 10, tick: 18, destructive: 12, blocked: 30, chirp: 24, command: 8, copy: 6, notification: 3, swoosh: 14, success: 5, error: 5, warning: 5 };

function play(patch: { play: (name: string, opts?: object) => unknown }, cue: Cue) {
  patch.play(cue.sound, { detune: (cue.detune ?? 0) + (Math.random() * 2 - 1) * JITTER[cue.sound], velocity: (cue.velocity ?? 1) * (0.9 + Math.random() * 0.1) });
}

const TOGGLE_SLOTS = new Set(["switch", "checkbox", "toggle", "toggle-group-item", "radio-group-item", "dropdown-menu-checkbox-item", "dropdown-menu-radio-item", "tabs-trigger", "sidebar-menu-button"]);
const INTERACTIVE = '[data-slot], button, a[href], [role="button"], [role="option"], [role="menuitem"], [role="tab"], input[type="checkbox"], input[type="radio"]';
const TEXT_ENTRY = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable]';

function rowPitch(el: HTMLElement) {
  const siblings = el.parentElement?.children;
  return siblings ? Math.min([...siblings].indexOf(el), 7) * 55 : 0;
}

function classify(el: HTMLElement): Cue | null {
  const slot = el.dataset.slot ?? "";
  const named = el.dataset.sound;
  if (named && named in PATCH.sounds) return { sound: named as SoundName };
  if (TOGGLE_SLOTS.has(slot) || el.matches('input[type="checkbox"], input[type="radio"], [aria-pressed]')) {
    const on = el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true" || el.getAttribute("data-active") !== null || el.getAttribute("aria-selected") === "true";
    return { sound: on ? "toggleOff" : "toggleOn", velocity: 0.8 };
  }
  if (el.dataset.variant === "destructive") return { sound: "destructive" };
  if (slot.endsWith("-close")) return { sound: "close" };
  if (slot.endsWith("-trigger")) {
    const expanded = el.getAttribute("aria-expanded");
    if (expanded === null) return { sound: "select" };
    return { sound: expanded === "true" ? "close" : "open" };
  }
  if (slot.endsWith("-item") || slot.endsWith("-link") || slot.endsWith("-option") || el.matches('[role="option"], [role="menuitem"], [cmdk-item]')) return { sound: "select", detune: rowPitch(el) };
  if (slot === "button" || el.matches('button, a[href], [role="button"]')) {
    const soft = el.dataset.variant === "ghost" || el.dataset.variant === "link" || el.dataset.variant === "outline";
    return { sound: "tap", velocity: soft ? 0.7 : 1 };
  }
  return null;
}

function soundFor(target: Element): Cue | null {
  const labeled = (target.closest("label") as HTMLLabelElement | null)?.control ?? target;
  if (labeled.closest(TEXT_ENTRY)) return null;
  let el = labeled.closest<HTMLElement>(INTERACTIVE);
  while (el) {
    if (el.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return { sound: "blocked" };
    const cue = classify(el);
    if (cue) return cue;
    el = el.parentElement?.closest<HTMLElement>(INTERACTIVE) ?? null;
  }
  return null;
}

// ---- mute state (localStorage, cross-tab) ----------------------------------------------------------------
const listeners = new Set<() => void>();
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
function readMuted() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "1";
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}
export function setSoundMuted(muted: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {}
  for (const l of listeners) l();
}
export function useSoundMuted() {
  return useSyncExternalStore(subscribe, readMuted, () => true);
}

// ---- provider + hook ---------------------------------------------------------------------------------------
const SoundContext = createContext<(cue: SoundName, opts?: Omit<Cue, "sound">) => void>(() => {});

/** `const sound = useSound(); sound("success")` — no-op while muted or before the audio context is ready. */
export function useSound() {
  return useContext(SoundContext);
}

function Listener({ children }: { children: ReactNode }) {
  const patch = usePatch(PATCH);
  const muted = useSoundMuted();
  const wasMuted = useRef(muted);

  const cue = useCallback(
    (sound: SoundName, opts?: Omit<Cue, "sound">) => {
      if (!patch.ready || readMuted()) return;
      play(patch, { sound, ...opts });
    },
    [patch],
  );

  useEffect(() => {
    const cameBack = wasMuted.current && !muted;
    wasMuted.current = muted;
    if (cameBack && patch.ready) play(patch, { sound: "swoosh" });
  }, [muted, patch]);

  useEffect(() => {
    if (!patch.ready) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element) || readMuted()) return;
      const c = soundFor(event.target);
      if (c) play(patch, c);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== "Enter" && event.key !== " ") || event.repeat || !(event.target instanceof Element) || readMuted()) return;
      if (event.target.matches(TEXT_ENTRY)) return;
      const c = soundFor(event.target);
      if (c) play(patch, c);
    };
    const observer = new MutationObserver((records) => {
      if (readMuted()) return;
      for (const r of records) {
        const el = r.target;
        if (!(el instanceof HTMLElement) || !r.attributeName) continue;
        const value = el.getAttribute(r.attributeName);
        const entered = value !== null && value !== "false" && value !== r.oldValue;
        if (r.attributeName === "aria-invalid" && entered) play(patch, { sound: "error" });
        if (r.attributeName === "data-success" && entered) play(patch, { sound: "success" });
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["aria-invalid", "data-success"] });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [patch]);

  return <SoundContext.Provider value={cue}>{children}</SoundContext.Provider>;
}

export function SoundEffects({ children }: { children: ReactNode }) {
  const muted = useSoundMuted();
  return (
    <SoundProvider enabled={!muted} volume={VOLUME}>
      <Listener>{children}</Listener>
    </SoundProvider>
  );
}

export function SoundToggle() {
  const muted = useSoundMuted();
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={muted ? "Unmute interface sounds" : "Mute interface sounds"} aria-pressed={!muted} data-sound="swoosh" onClick={() => setSoundMuted(!muted)} />}>
        {muted ? <VolumeX /> : <Volume2 />}
      </TooltipTrigger>
      <TooltipContent>{muted ? "Sounds off" : "Sounds on"}</TooltipContent>
    </Tooltip>
  );
}
