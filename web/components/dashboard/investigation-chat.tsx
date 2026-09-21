"use client";

import { Plus, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AISidebar,
  type SidebarResource,
} from "@/components/agents/ai-sidebar";
import { ChatApp } from "@/components/agents/chat-app";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageGroup,
  MessageTyping,
} from "@/components/agents/message";
import { MessageScroller } from "@/components/agents/message-scroller";
import { PromptInput } from "@/components/agents/prompt-input";
import {
  AnimatedSidebar,
  AnimatedSidebarTrigger,
} from "@/components/motion/animated-sidebar";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { Investigation } from "@/lib/pipeline-types";
import { AnswerView } from "./answer-view";
import { Orb } from "./orb";
import { useWorkspace } from "./workspace-provider";

type Turn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; inv: Investigation; stream: boolean };

const STARTERS = [
  "What changed in the latest SEBI publication?",
  "Which circulars conflict with our policies?",
  "What needs my review?",
  "Show POL-001",
];

/** Investigation chat: beui chat shell around our /api/ask. Every answer is structured and assembled from records. */
export function InvestigationChat({
  initialLogin,
  avatar,
}: {
  initialLogin: string;
  avatar?: string | null;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const { recent, addRecent } = useWorkspace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function ask(question: string) {
    const q = question.trim();
    if (q.length < 2 || busy) return;
    setError(null);
    setTurns((t) => [...t, { id: `u-${Date.now()}`, role: "user", text: q }]);
    setBusy(true);
    try {
      const inv = await api<Investigation>("ask", {
        method: "POST",
        body: JSON.stringify({ question: q }),
      });
      addRecent(inv);
      setTurns((t) => [
        ...t,
        { id: inv.id, role: "assistant", inv, stream: true },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = params.get("q");
    const open = params.get("open");
    const t = setTimeout(() => {
      if (q) {
        void ask(q);
        router.replace("/dashboard/ask");
      } else if (open) {
        const inv = recent.find((r) => r.id === open);
        if (inv)
          setTurns([
            { id: `u-${inv.id}`, role: "user", text: inv.question },
            { id: inv.id, role: "assistant", inv, stream: false },
          ]);
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items: SidebarResource[] = recent
    .filter(
      (inv, i, arr) =>
        arr.findIndex(
          (x) =>
            x.question.trim().toLowerCase() ===
            inv.question.trim().toLowerCase(),
        ) === i,
    )
    .map((r) => ({ id: r.id, label: r.question, kind: "file" as const }));
  const activeId =
    [...turns].reverse().find((t) => t.role === "assistant")?.id ?? null;

  return (
    <ChatApp
      className="h-[calc(100dvh-8rem)] rounded-lg"
      sidebarWidth="16rem"
      defaultOpen
    >
      <div className="flex h-full min-h-0">
        <AnimatedSidebar
          collapsible="offcanvas"
          ariaLabel="Investigations"
          className="border-r border-border bg-sidebar"
          panelClassName="flex h-full flex-col"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">
              Investigations
            </p>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="New investigation"
              onClick={() => setTurns([])}
            >
              <Plus />
            </Button>
          </div>
          {items.length ? (
            <AISidebar
              items={items}
              activeId={activeId}
              onActiveChange={(id) => {
                const inv = recent.find((r) => r.id === id);
                if (inv)
                  setTurns([
                    { id: `u-${inv.id}`, role: "user", text: inv.question },
                    { id: inv.id, role: "assistant", inv, stream: false },
                  ]);
              }}
              renderIcon={() => <Search className="size-3.5" />}
              ariaLabel="Recent investigations"
              className="px-1"
            />
          ) : (
            <p className="px-3 text-xs text-muted-foreground">Nothing yet.</p>
          )}
        </AnimatedSidebar>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <AnimatedSidebarTrigger
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Toggle investigations"
            />
            <Orb
              state={
                busy ? "weaving" : turns.length ? "composing" : "solving"
              }
              px={28}
            />
            <p className="text-sm font-medium">Ask AfterCircular</p>
            <p className="hidden text-xs text-muted-foreground sm:block">
              · routed by Jev, answered from this workspace
            </p>
          </div>
          <MessageScroller
            className="min-h-0 flex-1"
            contentClassName="mx-auto w-full max-w-3xl space-y-6 px-4 py-6"
            busy={busy}
            label="Investigation"
          >
            {!turns.length ? (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <Orb state="solving" px={64} />
                <div>
                  <p className="text-base font-medium">
                    Investigate this workspace
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Questions are routed by typed judgments; answers are
                    assembled from records, never generated.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {STARTERS.map((s) => (
                    <Button
                      key={s}
                      variant="outline"
                      size="sm"
                      onClick={() => ask(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            {turns.map((t) =>
              t.role === "user" ? (
                <Message key={t.id} from="user" animateIn>
                  <MessageAvatar>
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="" />
                    ) : (
                      initialLogin.slice(0, 2).toUpperCase()
                    )}
                  </MessageAvatar>
                  <MessageContent>{t.text}</MessageContent>
                </Message>
              ) : (
                <Message key={t.id} from="assistant" animateIn>
                  <MessageAvatar>
                    <Orb state="composing" px={24} />
                  </MessageAvatar>
                  <MessageContent className="w-full max-w-none">
                    <AnswerView
                      inv={t.inv}
                      stream={t.stream}
                      onAsk={(q) => ask(q)}
                    />
                  </MessageContent>
                </Message>
              ),
            )}
            {busy ? (
              <MessageGroup>
                <Message from="assistant">
                  <MessageAvatar>
                    <Orb state="weaving" px={24} />
                  </MessageAvatar>
                  <MessageContent>
                    <MessageTyping label="Routing your question" />
                  </MessageContent>
                </Message>
              </MessageGroup>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </MessageScroller>
          <div className="border-t border-border px-4 py-3">
            <div className="mx-auto max-w-3xl">
              <PromptInput
                placeholder="Ask about circulars, conflicts, reviews or a policy…"
                onSubmit={(v) => ask(v)}
                loading={busy}
                minRows={1}
                maxRows={5}
              />
            </div>
          </div>
        </div>
      </div>
    </ChatApp>
  );
}
