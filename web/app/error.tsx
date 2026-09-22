"use client";

import { Button } from "@/components/ui/button";

/** Root error boundary: errors thrown by a layout (e.g. the dashboard shell when the backend is down) land here, not on a bare 500. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const backendDown =
    /fetch failed|ECONNREFUSED|Backend 5\d\d|unreachable/i.test(error.message);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <div className="flex max-w-lg flex-col items-center gap-3 text-center">
        <p className="text-base font-medium">
          {backendDown ? "Backend unreachable" : "Something went wrong"}
        </p>
        <p className="text-sm text-muted-foreground">
          {backendDown
            ? "The AfterCircular API is not answering. Start it with `cd backend && uv run uvicorn app.main:app --port 8010`, then retry. Nothing here is cached or simulated."
            : error.message}
        </p>
        {error.digest ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            ref {error.digest}
          </p>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => reset()}>
          Retry
        </Button>
      </div>
    </div>
  );
}
