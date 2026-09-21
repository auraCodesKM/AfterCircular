"use client";

import { useEffect, useState } from "react";

/** Reveals `text` progressively so a complete answer reads as it arrives. Reduced motion → instant. */
export function useTypewriter(text: string, cps = 90): { shown: string; done: boolean } {
  const [state, setState] = useState({ text, n: 0 });
  const n = state.text === text ? state.n : 0; // a new text restarts without an extra render
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const next = reduce ? text.length : Math.min(text.length, Math.floor(((now - start) / 1000) * cps));
      setState({ text, n: next });
      if (next < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, cps]);
  return { shown: text.slice(0, n), done: n >= text.length };
}
