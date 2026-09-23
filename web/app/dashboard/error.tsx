"use client";

import { Button } from "@/components/ui/button";

/** Route error boundary: a backend that is down must read as "backend unreachable", never as a blank 500. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // a production build redacts the message, so the server tags the digest instead
  const backendDown = error.digest === "BACKEND_UNREACHABLE" || /fetch failed|ECONNREFUSED|Backend 5\d\d|unreachable/i.test(error.message);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-base font-medium">{backendDown ? "Backend unreachable" : "Something went wrong"}</p>
      <p className="text-sm text-muted-foreground">
        {backendDown
          ? "The AfterCircular API is not answering. Start it with `cd backend && uv run uvicorn app.main:app --port 8010`, then retry. Nothing on this page is cached or simulated."
          : error.message}
      </p>
      {error.digest ? <p className="font-mono text-[11px] text-muted-foreground">ref {error.digest}</p> : null}
      <Button variant="outline" size="sm" onClick={() => reset()}>
        Retry
      </Button>
    </div>
  );
}
