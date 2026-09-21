"use client";

import { ThinkingOrb, type OrbState } from "thinking-orbs";

export type { OrbState };

/** AI presence. The library ships two tuned sizes (20, 64); `scale` enlarges the inline one a touch. Hidden under reduced motion. */
export function Orb({ state = "breathing", size = 20, scale, speed, paused, className, label }: { state?: OrbState; size?: 20 | 64; scale?: number; speed?: number; paused?: boolean; className?: string; label?: string }) {
  const s = scale ?? (size === 20 ? 1.4 : 1);
  const box = Math.round(size * s);
  return (
    <span className={`inline-flex shrink-0 items-center justify-center motion-reduce:hidden ${className ?? ""}`} style={{ width: box, height: box }}>
      <ThinkingOrb state={state} size={size} speed={speed} paused={paused} aria-label={label ?? state} style={{ transform: `scale(${s})`, transformOrigin: "center" }} />
    </span>
  );
}
