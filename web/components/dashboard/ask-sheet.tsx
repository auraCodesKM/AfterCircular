"use client";

import { ArrowUpRight, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PromptInput } from "@/components/agents/prompt-input";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/client-api";
import { EASE_OUT } from "@/lib/ease";
import type { Investigation } from "@/lib/pipeline-types";
import { AnswerView } from "./answer-view";
import { questionsFor } from "./ask-questions";
import { Orb } from "./orb";
import { useSound } from "./sound-effects";
import { useWorkspace } from "./workspace-provider";

type Turn = { id: string; question: string; inv?: Investigation; error?: string; streamed?: boolean };

/**
 * The agent surface: a right-hand sheet built like a small conversation. Header says what it is and
 * how it answers; the thread grows downward; the composer stays at the bottom, where the dock left it.
 */
export function AskSheet() {
  const { ask } = useWorkspace();
  return (
    <Sheet open={ask.open} onOpenChange={ask.setOpen}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-xl">{ask.open ? <AskBody key={ask.question} initial={ask.question} /> : null}</SheetContent>
    </Sheet>
  );
}

function AskBody({ initial }: { initial: string }) {
  const { ask, addRecent, health } = useWorkspace();
  const pathname = usePathname();
  const sound = useSound();
  const reduce = useReducedMotion() ?? false;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function submit(raw: string) {
    const question = raw.trim();
    if (question.length < 2 || busy) return;
    const id = `${Date.now()}`;
    setTurns((t) => [...t, { id, question }]);
    setBusy(true);
    try {
      const inv = await api<Investigation>("ask", { method: "POST", body: JSON.stringify({ question }) });
      addRecent(inv);
      sound(inv.intent === "other" ? "warning" : "chirp");
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, inv } : x)));
    } catch (e) {
      sound("error");
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  }

  // The body is keyed by the question, so a fresh mount is the only way `initial` arrives; the timeout
  // (not a ref flag) keeps StrictMode's double-run from submitting twice or not at all.
  useEffect(() => {
    if (!initial) return;
    const t = setTimeout(() => void submit(initial), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // keep the newest turn in view as it arrives
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns, busy, reduce]);

  const judge = health?.judge?.default === "typesafe" ? "Jev" : health?.judge?.default === "stub" ? "keywords" : "Foundry";
  const suggestions = questionsFor(pathname);

  return (
    <>
      <SheetHeader className="flex-row items-center gap-3 border-b border-border/80 bg-background/90 px-5 py-3 pr-14 backdrop-blur">
        <Orb state={busy ? "weaving" : turns.length ? "composing" : "solving"} px={30} />
        <div className="min-w-0">
          <SheetTitle className="text-sm font-semibold tracking-tight">Ask AfterCircular</SheetTitle>
          <SheetDescription className="truncate text-xs">
            Routed by {judge} · answered from this workspace&rsquo;s records, never generated
          </SheetDescription>
        </div>
      </SheetHeader>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        {!turns.length ? (
          <div className="flex h-full flex-col justify-end gap-6 pb-2">
            <div className="space-y-2">
              <p className="text-lg font-semibold tracking-tight text-balance">What do you want to know about this workspace?</p>
              <p className="text-sm leading-6 text-muted-foreground">Questions about circulars, conflicts, reviews and policies are answered from records — every answer links to its evidence.</p>
            </div>
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles aria-hidden className="size-3" /> Start with
              </p>
              <ul className="flex flex-col gap-1.5">
                {suggestions.map((q, i) => (
                  <motion.li key={q} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE_OUT, delay: i * 0.05 }}>
                    <button type="button" onClick={() => void submit(q)} className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-sm transition-colors hover:border-foreground/25 hover:bg-muted/40 active:translate-y-px">
                      <span>{q}</span>
                      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                    </button>
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <ol className="space-y-6">
          <AnimatePresence initial={false}>
            {turns.map((t) => (
              <motion.li key={t.id} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="space-y-3">
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm leading-6">{t.question}</p>
                </div>
                {t.inv ? (
                  <div className="space-y-3">
                    <AnswerView inv={t.inv} compact onAsk={(s) => void submit(s)} onDone={() => setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, streamed: true } : x)))} />
                    {t.streamed ? (
                      <motion.div initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE_OUT }}>
                        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/dashboard/investigations/${t.inv.id}`} onClick={() => ask.setOpen(false)} />}>
                          Open full investigation <ArrowUpRight />
                        </Button>
                      </motion.div>
                    ) : null}
                  </div>
                ) : t.error ? (
                  <p className="text-sm text-destructive">{t.error}</p>
                ) : (
                  <div className="flex items-center gap-3" aria-busy aria-live="polite">
                    <Orb state="weaving" px={40} />
                    <div>
                      <TextShimmer className="text-sm font-medium" duration={1.8}>
                        Routing your question…
                      </TextShimmer>
                      <p className="text-xs text-muted-foreground">{judge === "Jev" ? "Jev picks the intent, document and policy; code assembles the answer." : "Matching intent, then assembling the answer from records."}</p>
                    </div>
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>

      <div className="border-t border-border/80 bg-background px-4 py-3">
        <PromptInput placeholder={turns.length ? "Ask a follow-up…" : "Ask about circulars, conflicts, reviews or a policy…"} onSubmit={(v) => void submit(v)} loading={busy} minRows={1} maxRows={4} autoFocus />
      </div>
    </>
  );
}
