"use client";

import { ArrowUp, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { Investigation } from "@/lib/pipeline-types";
import { AnswerView } from "./answer-view";
import { Orb } from "./orb";
import { useWorkspace } from "./workspace-provider";

const SUGGESTIONS = [
  "What changed in the latest SEBI publication?",
  "Which circulars conflict with our policies?",
  "What needs my review?",
  "Show POL-001",
];

/** The agent surface: a small right-hand sheet. Ask → structured answer → open the full investigation. */
export function AskSheet() {
  const { ask } = useWorkspace();
  return (
    <Sheet open={ask.open} onOpenChange={ask.setOpen}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-xl">
        {ask.open ? (
          <AskBody key={ask.question} initial={ask.question} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AskBody({ initial }: { initial: string }) {
  const { ask, addRecent } = useWorkspace();
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inv, setInv] = useState<Investigation | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const submitRef = useRef<(question?: string) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.focus();
      if (initial) void submitRef.current(initial);
    }, 30);
    return () => clearTimeout(t);
  }, [initial]);

  async function submit(question = q) {
    if (question.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<Investigation>("ask", {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      setInv(res);
      addRecent(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    submitRef.current = submit;
  });

  return (
    <>
      <SheetHeader className="border-b border-border px-5 py-4">
        <SheetTitle className="flex items-center gap-2 text-base">
          <Orb state={busy ? "weaving" : inv ? "composing" : "solving"} px={28} />
          Ask AfterCircular
        </SheetTitle>
        <SheetDescription>
          Questions are routed by typed judgments and answered from this
          workspace&rsquo;s records.
        </SheetDescription>
      </SheetHeader>
      <div className="border-b border-border px-5 py-3">
        <div className="relative">
          <Textarea
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="What changed in the latest SEBI publication?"
            rows={2}
            aria-label="Question"
            className="pr-12"
          />
          <div className="absolute right-1.5 bottom-1.5">
            <button
              type="button"
              onClick={() => submit()}
              disabled={busy || q.trim().length < 2}
              aria-label="Ask"
              className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"
            >
              {busy ? <Orb state="solving" px={22} /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
        {!inv && !busy ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="xs"
                onClick={() => {
                  setQ(s);
                  void submit(s);
                }}
              >
                {s}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {busy ? (
          <div className="space-y-4" aria-busy aria-live="polite">
            <div className="flex items-center gap-3">
              <Orb state="weaving" px={64} />
              <div className="space-y-1">
                <p className="text-sm">Routing your question…</p>
                <p className="text-xs text-muted-foreground">Jev picks the intent, document and policy; code assembles the answer.</p>
              </div>
            </div>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {inv && !busy ? (
          <div className="space-y-4">
            <AnswerView
              inv={inv}
              compact
              onAsk={(s) => {
                setQ(s);
                void submit(s);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  href={`/dashboard/investigations/${inv.id}`}
                  onClick={() => ask.setOpen(false)}
                />
              }
            >
              Open full investigation <ArrowUpRight />
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
