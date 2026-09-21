"use client";

import {
  Activity,
  AlertTriangle,
  BookOpen,
  ClipboardCheck,
  Cpu,
  FileText,
  GitBranch,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { api } from "@/lib/client-api";
import type {
  PolicyIndex,
  ProcessedDocument,
  ScanRecord,
} from "@/lib/pipeline-types";
import { useWorkspace } from "./workspace-provider";

/** ⌘K: commands, circulars and policies in one place. Typing a sentence becomes a question for the agent. */
export function CommandPalette() {
  const router = useRouter();
  const { palette, ask, analysis } = useWorkspace();
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<ProcessedDocument[]>([]);
  const [policies, setPolicies] = useState<PolicyIndex["documents"]>([]);

  useEffect(() => {
    if (!palette.open) return;
    api<ProcessedDocument[]>("documents")
      .then(setDocs)
      .catch(() => setDocs([]));
    api<PolicyIndex>("policies")
      .then((p) => setPolicies(p.documents))
      .catch(() => setPolicies([]));
  }, [palette.open]);

  const close = () => palette.setOpen(false);
  const nav = (href: string) => {
    close();
    router.push(href);
  };
  const run = async () => {
    close();
    try {
      await api<ScanRecord>("scan", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast("Scan started");
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      toast.error("Could not start scan", {
        description: (e as Error).message,
      });
    }
  };
  const isQuestion = query.trim().split(/\s+/).length >= 3;
  const pending = docs.find((d) => d.status === "AWAITING_REVIEW");

  return (
    <CommandDialog
      open={palette.open}
      onOpenChange={palette.setOpen}
      title="Ask AfterCircular"
      description="Commands, circulars, policies — or type a question"
    >
      <Command shouldFilter={!isQuestion}>
        <CommandInput
          placeholder="Ask AfterCircular or type a command…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matches. Press Enter to ask the agent.</CommandEmpty>
          {isQuestion ? (
            <CommandGroup heading="Agent">
              <CommandItem
                value={`ask ${query}`}
                onSelect={() => ask.start(query)}
              >
                <MessageSquare />
                Ask: “{query}”
              </CommandItem>
            </CommandGroup>
          ) : null}
          <CommandGroup heading="Actions">
            <CommandItem onSelect={run}>
              <RefreshCw />
              Scan regulations now
            </CommandItem>
            <CommandItem onSelect={() => ask.start()}>
              <MessageSquare />
              Start investigation
            </CommandItem>
            {pending ? (
              <CommandItem
                onSelect={() => {
                  close();
                  analysis.open(pending);
                }}
              >
                <ClipboardCheck />
                Open pending review — {pending.title}
              </CommandItem>
            ) : null}
            <CommandItem
              onSelect={() =>
                ask.start("Which circulars conflict with our policies?")
              }
            >
              <AlertTriangle />
              Show conflicts
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => nav("/dashboard/documents")}>
              <FileText />
              Documents
            </CommandItem>
            <CommandItem onSelect={() => nav("/dashboard/reviews")}>
              <ClipboardCheck />
              Reviews
            </CommandItem>
            <CommandItem onSelect={() => nav("/dashboard/policies")}>
              <BookOpen />
              Policies
            </CommandItem>
            <CommandItem onSelect={() => nav("/dashboard/activity")}>
              <Activity />
              Recent activity
            </CommandItem>
            <CommandItem onSelect={() => nav("/dashboard/models")}>
              <Cpu />
              Model intelligence
            </CommandItem>
            <CommandItem onSelect={() => nav("/connect")}>
              <GitBranch />
              Change repository
            </CommandItem>
          </CommandGroup>
          {docs.length ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Circulars">
                {docs.slice(0, 8).map((d) => (
                  <CommandItem
                    key={d.id}
                    value={`${d.title} ${d.circular_number ?? ""}`}
                    onSelect={() => {
                      close();
                      analysis.open(d);
                    }}
                  >
                    <FileText />
                    <span className="truncate">{d.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {d.impact === "NOT_APPLICABLE"
                        ? "N/A"
                        : (d.impact ?? d.status)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
          {policies.length ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Policies">
                {policies.map((p) => (
                  <CommandItem
                    key={p.doc_id}
                    value={`${p.doc_id} ${p.title}`}
                    onSelect={() => ask.start(`Show ${p.doc_id}`)}
                  >
                    <BookOpen />
                    <span className="font-mono text-xs">{p.doc_id}</span>
                    <span className="truncate">{p.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
