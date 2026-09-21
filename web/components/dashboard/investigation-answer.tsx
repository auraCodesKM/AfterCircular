"use client";

import type { Investigation } from "@/lib/pipeline-types";
import { AnswerView } from "./answer-view";
import { useWorkspace } from "./workspace-provider";

export function InvestigationAnswer({ inv }: { inv: Investigation }) {
  const { ask } = useWorkspace();
  return <AnswerView inv={inv} onAsk={(q) => ask.start(q)} />;
}
