"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "cn";

const isGap = (tok: string) => /^\s+$/.test(tok);

/**
 * Reveals a finished answer the way a model would have produced it: word by word, each word rising out
 * of a slight blur, with a caret at the frontier. Word cadence is uneven on purpose — a metronome reads
 * as fake. Reduced motion shows everything at once.
 */
export function StreamingText({ text, onDone, wps = 14, className, renderToken }: { text: string; onDone?: () => void; wps?: number; className?: string; /** Custom rendering for a word (e.g. identifiers as code); punctuation stays attached. */ renderToken?: (token: string) => React.ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  const tokens = useMemo(() => text.split(/(\s+)/).filter(Boolean), [text]);
  // progress is keyed to the text it belongs to, so a new text restarts without a reset render
  const [progress, setProgress] = useState({ text, n: 0 });
  const n = reduce ? tokens.length : progress.text === text ? progress.n : 0;
  const done = n >= tokens.length;

  useEffect(() => {
    if (reduce) {
      const t = setTimeout(() => onDone?.(), 0);
      return () => clearTimeout(t);
    }
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      i += 1;
      while (i < tokens.length && isGap(tokens[i])) i += 1; // gaps are free: pacing counts words
      const next = Math.min(i, tokens.length);
      setProgress({ text, n: next });
      if (next >= tokens.length) {
        onDone?.();
        return;
      }
      const base = 1000 / wps;
      const word = tokens[next] ?? "";
      const pause = /[.!?]$/.test(word) ? base * 2.2 : /[,;:]$/.test(word) ? base * 1.4 : 0;
      t = setTimeout(step, base * (0.6 + Math.random() * 0.8) + pause);
    };
    t = setTimeout(step, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, reduce, wps]);

  return (
    <span className={cn("whitespace-pre-wrap", className)} aria-label={text}>
      {tokens.slice(0, n).map((tok, i) =>
        isGap(tok) ? (
          tok
        ) : (
          <motion.span
            key={i}
            aria-hidden
            initial={reduce ? false : { opacity: 0, y: 3, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
            className="inline-block"
          >
            {renderToken ? renderToken(tok) : tok}
          </motion.span>
        ),
      )}
      {!done ? <span aria-hidden className="ml-px inline-block h-[1em] w-[2px] translate-y-[0.15em] rounded-sm bg-foreground/70 animate-caret-blink" /> : null}
    </span>
  );
}
