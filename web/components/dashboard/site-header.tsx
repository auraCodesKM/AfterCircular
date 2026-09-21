"use client";

import { ChevronRight, MessageSquareText, Search } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { EASE_OUT } from "@/lib/ease";
import { NAV } from "./app-sidebar";
import { SoundToggle } from "./sound-effects";
import { ThemeToggle } from "./theme-toggle";
import { useWorkspace } from "./workspace-provider";

/**
 * Where am I, and how do I search — nothing else. Company sits quiet, the page name carries the weight
 * and glides on route change; ⌘K is one pill that reads like the field it opens.
 */
export function SiteHeader({ companyName }: { companyName: string }) {
  const pathname = usePathname();
  const reduce = useReducedMotion() ?? false;
  const { palette } = useWorkspace();
  const investigation = pathname.includes("/investigations/") || pathname.startsWith("/dashboard/ask");
  const nav = NAV.find((n) => (n.href === "/dashboard" ? pathname === n.href : pathname.startsWith(n.href)));
  const current = investigation ? "Investigation" : pathname.startsWith("/dashboard/profile") ? "Profile" : (nav?.label ?? "Overview");
  const Icon = investigation ? MessageSquareText : nav?.icon;

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-1.5 border-b border-border/70 bg-background/80 px-2.5 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 md:px-4">
      <SidebarTrigger className="-ml-0.5 text-muted-foreground hover:text-foreground" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
        <span className="hidden truncate text-muted-foreground sm:inline">{companyName}</span>
        <ChevronRight aria-hidden className="hidden size-3.5 shrink-0 text-muted-foreground/60 sm:inline" />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={current}
            initial={reduce ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -5 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="inline-flex items-center gap-1.5 font-medium"
            aria-current="page"
          >
            {Icon ? <Icon aria-hidden className="size-3.5 text-muted-foreground" /> : null}
            {current}
          </motion.span>
        </AnimatePresence>
      </nav>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => palette.setOpen(true)}
          aria-label="Search or ask AfterCircular"
          className="group mr-1 flex h-8 items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/70 hover:text-foreground sm:w-64 sm:px-2.5"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="hidden flex-1 text-left sm:inline">Search or ask…</span>
          <kbd className="hidden rounded border border-border bg-background px-1 font-mono text-[10px] text-muted-foreground transition-colors group-hover:text-foreground sm:inline">⌘K</kbd>
        </button>
        <SoundToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
