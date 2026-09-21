"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Health, Investigation, ProcessedDocument } from "@/lib/pipeline-types";

/** Client-side workspace state: the agent sheet, the command palette and the analysis sheet can be opened from anywhere. */
type Ctx = {
  health: Health | null;
  tenant: { companyName: string; repo: string; branch: string };
  recent: Investigation[];
  ask: { open: boolean; question: string; setOpen: (o: boolean) => void; start: (q?: string) => void };
  palette: { open: boolean; setOpen: (o: boolean) => void };
  analysis: { doc: ProcessedDocument | null; open: (d: ProcessedDocument) => void; close: () => void };
  addRecent: (inv: Investigation) => void;
};

const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children, health, tenant, recent: initialRecent }: { children: ReactNode; health: Health | null; tenant: Ctx["tenant"]; recent: Investigation[] }) {
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [doc, setDoc] = useState<ProcessedDocument | null>(null);
  const [recent, setRecent] = useState(initialRecent);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const start = useCallback((q = "") => {
    setQuestion(q);
    setPaletteOpen(false);
    setAskOpen(true);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      health,
      tenant,
      recent,
      ask: { open: askOpen, question, setOpen: setAskOpen, start },
      palette: { open: paletteOpen, setOpen: setPaletteOpen },
      analysis: { doc, open: setDoc, close: () => setDoc(null) },
      addRecent: (inv) => setRecent((r) => [inv, ...r.filter((x) => x.id !== inv.id)].slice(0, 8)),
    }),
    [health, tenant, recent, askOpen, question, start, paletteOpen, doc],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside WorkspaceProvider");
  return ctx;
}
