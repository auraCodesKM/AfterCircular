import type { ReactNode } from "react";

/** Remounts per navigation so every page enters the same way: a short rise-and-fade. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-300 ease-out motion-reduce:animate-none">{children}</div>;
}
