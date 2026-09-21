"use client";

import { Button } from "@/components/ui/button";
import { Orb } from "./orb";
import { useWorkspace } from "./workspace-provider";

/** The agent entry point on the overview: a single line, not a chat box. */
export function AskBar() {
  const { ask } = useWorkspace();
  return (
    <div className="metal-edge flex flex-wrap items-center gap-2 rounded-md bg-background px-3 py-2">
      <button type="button" onClick={() => ask.start()} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground">
        <Orb state="solving" px={28} />
        Ask about this workspace…
      </button>
      <div className="flex flex-wrap gap-1">
        {["What changed?", "Which circulars conflict?", "What needs my review?"].map((q) => (
          <Button key={q} variant="ghost" size="xs" onClick={() => ask.start(q)}>
            {q}
          </Button>
        ))}
      </div>
    </div>
  );
}
