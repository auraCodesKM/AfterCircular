"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { EASE_OUT } from "@/lib/ease";

/** A number that settles into place on mount instead of appearing. Reduced motion renders the final value. */
export function CountUp({ value, duration = 0.9 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion() ?? false;
  const [shown, setShown] = useState(0);
  const instant = reduce || value === 0;
  useEffect(() => {
    if (instant) return;
    const controls = animate(0, value, { duration, ease: EASE_OUT, onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [value, duration, instant]);
  return <>{instant ? value : shown}</>;
}
