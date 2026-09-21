"use client";

import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NAV } from "./app-sidebar";
import { ThemeToggle } from "./theme-toggle";
import { useWorkspace } from "./workspace-provider";

export function SiteHeader({ companyName }: { companyName: string }) {
  const pathname = usePathname();
  const { palette } = useWorkspace();
  const current = pathname.includes("/investigations/") || pathname.startsWith("/dashboard/ask") ? "Investigation" : pathname.startsWith("/dashboard/profile") ? "Profile" : (NAV.find((n) => (n.href === "/dashboard" ? pathname === n.href : pathname.startsWith(n.href)))?.label ?? "Overview");
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 !h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:block">
            <span className="text-muted-foreground">{companyName}</span>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{current}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => palette.setOpen(true)} className="h-8 w-8 justify-start gap-2 px-0 text-muted-foreground sm:w-64 sm:px-2.5" aria-label="Ask AfterCircular or run a command">
          <Search className="mx-auto sm:mx-0" />
          <span className="hidden sm:inline">Ask AfterCircular…</span>
          <kbd className="ml-auto hidden rounded border border-border px-1 font-mono text-[10px] sm:inline">⌘K</kbd>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
