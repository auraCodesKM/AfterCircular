"use client";

import dynamic from "next/dynamic";
import type { OrbState } from "thinking-orbs";

/** Canvas is client-only; dynamic import keeps SSR output stable. `auto` theme follows the `.dark` class on <html>. */
const ThinkingOrb = dynamic(() => import("thinking-orbs").then((m) => m.ThinkingOrb), { ssr: false, loading: () => <span aria-hidden className="inline-block size-5" /> });

export type { OrbState };

export function Orb({ state = "breathing", size = 20, speed, paused, className, label }: { state?: OrbState; size?: 20 | 64; speed?: number; paused?: boolean; className?: string; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center motion-reduce:hidden ${className ?? ""}`} style={{ width: size, height: size }}>
      <ThinkingOrb state={state} size={size} speed={speed} paused={paused} aria-label={label ?? state} />
    </span>
  );
}
