"use client";

import { ArrowUp } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EASE_OUT } from "@/lib/ease";
import { questionsFor } from "./ask-questions";
import { Orb } from "./orb";
import { useWorkspace } from "./workspace-provider";

/**
 * The one place to ask, on every page, in the same place: a composer docked to the bottom of the
 * workspace with three ready questions that follow the route. Submitting opens the ask sheet.
 * `/` focuses it from anywhere; the chat page has its own composer, so the dock steps aside there.
 */
export function AskDock() {
  const pathname = usePathname();
  const { ask } = useWorkspace();
  const reduce = useReducedMotion() ?? false;
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hidden = pathname.startsWith("/dashboard/ask");

  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden]);

  if (hidden) return null;
  const questions = questionsFor(pathname);
  const submit = (q: string) => {
    const question = q.trim();
    if (question.length < 2) return;
    setValue("");
    inputRef.current?.blur();
    ask.start(question);
  };

  return (
    <div className="pointer-events-none sticky bottom-0 z-20 mt-auto">
      {/* Content scrolls under a soft fade, never under a hard edge. */}
      <div aria-hidden className="h-8 bg-gradient-to-t from-background to-transparent" />
      <div className="bg-background/85 px-4 pb-4 backdrop-blur-md md:px-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
          className="metal-edge pointer-events-auto mx-auto max-w-3xl rounded-2xl bg-background transition-shadow duration-300 focus-within:shadow-[0_12px_40px_-16px_rgb(0_0_0/0.35)]"
        >
          <label className="flex items-center gap-3 px-3.5 py-2.5">
            <Orb state={focused ? "composing" : "solving"} px={26} />
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Ask about this workspace…"
              aria-label="Ask AfterCircular"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            {!value ? (
              <kbd className="hidden rounded border border-border bg-muted/50 px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-block">/</kbd>
            ) : null}
            <motion.button
              type="submit"
              disabled={value.trim().length < 2}
              aria-label="Ask"
              whileTap={reduce ? undefined : { scale: 0.92 }}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity duration-200 disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" />
            </motion.button>
          </label>
          <div className="scrollbar-hide flex items-center gap-1.5 overflow-x-auto border-t border-border/70 px-3 py-2 sm:flex-wrap sm:overflow-visible">
            <AnimatePresence mode="popLayout" initial={false}>
              {questions.map((q, i) => (
                <motion.button
                  key={q}
                  type="button"
                  layout
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.24, ease: EASE_OUT, delay: reduce ? 0 : i * 0.04 }}
                  onClick={() => submit(q)}
                  className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground active:translate-y-px"
                >
                  {q}
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </form>
      </div>
    </div>
  );
}
