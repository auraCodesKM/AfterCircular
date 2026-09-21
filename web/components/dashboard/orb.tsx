"use client";

import { ThinkingOrb, type OrbState } from "thinking-orbs";

export type { OrbState };

/** AI presence. Renders the dense 64px preset and scales it to `px` (the 20px preset is too sparse to read inline). Hidden under reduced motion. */
export function Orb({ state = "solving", px = 28, speed, paused, className, label }: { state?: OrbState; px?: number; speed?: number; paused?: boolean; className?: string; label?: string }) {
  const s = px / 64;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-visible motion-reduce:hidden ${className ?? ""}`} style={{ width: px, height: px }}>
      <ThinkingOrb state={state} size={64} speed={speed} paused={paused} aria-label={label ?? state} style={{ transform: `scale(${s})`, transformOrigin: "center", flexShrink: 0 }} />
    </span>
  );
}
