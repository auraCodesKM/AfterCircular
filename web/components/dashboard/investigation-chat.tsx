"use client";

import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Message, MessageAvatar, MessageContent } from "@/components/agents/message";
import { AgentSteps } from "@/components/xiod/agent-steps";
import { MessageScroller } from "@/components/agents/message-scroller";
import { PromptInput } from "@/components/agents/prompt-input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { Investigation } from "@/lib/pipeline-types";
import { AnswerView } from "./answer-view";
import { Orb } from "./orb";
import { useSound } from "./sound-effects";
import { useWorkspace } from "./workspace-provider";

type Turn = { id: string; role: "user"; text: string } | { id: string; role: "assistant"; inv: Investigation; stream: boolean };

const STARTERS = ["What changed in the latest SEBI publication?", "Which circulars conflict with our policies?", "What needs my review?", "Show POL-001"];

/** Investigation thread. One column, fills the workspace; recent investigations live in the app sidebar. */
export function InvestigationChat({ initialLogin, avatar }: { initialLogin: string; avatar?: string | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const { recent, addRecent } = useWorkspace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const sound = useSound();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const conversation = useRef<string | null>(null); // follow-ups share one id so the backend feeds previous turns back as context

  async function ask(question: string) {
    const q = question.trim();
    if (q.length < 2 || busy) return;
    setError(null);
    setTurns((t) => [...t, { id: `u-${Date.now()}`, role: "user", text: q }]);
    setBusy(true);
    try {
      const inv = await api<Investigation>("ask", { method: "POST", body: JSON.stringify({ question: q, conversation_id: conversation.current }) });
      conversation.current = inv.conversation_id ?? conversation.current;
      addRecent(inv);
      sound(inv.intent === "other" ? "warning" : "chirp");
      setTurns((t) => [...t, { id: inv.id, role: "assistant", inv, stream: true }]);
    } catch (e) {
      sound("error");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ?q= asks once; ?open=<id> loads a past investigation (from the sidebar). Both are consumed, never re-run.
  useEffect(() => {
    const q = params.get("q");
    const open = params.get("open");
    const key = q ? `q:${q}` : open ? `open:${open}` : null;
    if (!key || opened.current === key) return;
    opened.current = key;
    const t = setTimeout(async () => {
      if (q) {
        router.replace("/dashboard/ask");
        void ask(q);
        return;
      }
      let inv = recent.find((r) => r.id === open);
      if (!inv && open) {
        try {
          inv = await api<Investigation>(`investigations/${open}`);
        } catch {
          inv = undefined;
        }
      }
      if (inv) {
        conversation.current = inv.conversation_id ?? null; // continuing a past investigation keeps its thread
        setTurns([{ id: `u-${inv.id}`, role: "user", text: inv.question }, { id: inv.id, role: "assistant", inv, stream: false }]);
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3rem)] flex-col md:-mx-8 md:-my-8">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:px-6">
        <Orb state={busy ? "weaving" : turns.length ? "composing" : "solving"} px={26} />
        <p className="text-sm font-medium">Ask AfterCircular</p>
        <p className="hidden text-xs text-muted-foreground sm:block">· routed by Jev · grounded in workspace records · no web search unless you ask to look up sebi.gov.in</p>
        {turns.length ? (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => { setTurns([]); conversation.current = null; router.replace("/dashboard/ask"); }}>
            <Plus /> New
          </Button>
        ) : null}
      </div>
      <MessageScroller className="min-h-0 flex-1" contentClassName="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 md:px-6" busy={busy} label="Investigation">
        {!turns.length ? (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <Orb state="solving" px={72} />
            <div>
              <p className="text-base font-medium">Investigate this workspace</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">Ask about circulars, conflicts, reviews or a policy. Questions are routed by typed judgments; answers come from records.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {STARTERS.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => ask(s)}>
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
              <MessageAvatar className="bg-transparent">
                <Orb state="composing" px={26} />
              </MessageAvatar>
              <MessageContent className="w-full max-w-none">
                <AnswerView inv={t.inv} stream={t.stream} onAsk={(q) => ask(q)} />
              </MessageContent>
            </Message>
          ),
        )}
        {busy ? (
          <Message from="assistant">
            <MessageAvatar className="bg-transparent">
              <Orb state="weaving" px={26} />
            </MessageAvatar>
            <MessageContent>
              <AgentSteps size="sm" interval={2500} steps={[{ label: "Routing with Jev", icon: "thinking" }, { label: "Selecting workspace records", icon: "searching" }, { label: "Assembling evidence", icon: "verify" }, { label: "Writing with Microsoft Foundry", icon: "editing" }]} />
            </MessageContent>
          </Message>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </MessageScroller>
      <div className="border-t border-border px-4 py-3 md:px-6">
        <div className="mx-auto max-w-3xl">
          <PromptInput placeholder="Ask about circulars, conflicts, reviews or a policy…" onSubmit={(v) => ask(v)} loading={busy} minRows={1} maxRows={5} />
        </div>
      </div>
    </div>
  );
}
