"use client";

import { Activity, BookOpen, ClipboardCheck, Cpu, FileText, GitBranch, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/aftercircular-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

export const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/documents", label: "Documents", icon: FileText },
  { href: "/dashboard/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/dashboard/policies", label: "Policies", icon: BookOpen },
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
  { href: "/dashboard/models", label: "Models", icon: Cpu },
] as const;

export function AppSidebar({ companyName, repo, branch, pendingReviews }: { companyName: string; repo: string; branch: string; pendingReviews: number }) {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="px-3 py-3">
        <Logo href="/dashboard" compact={false} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton isActive={active} render={<Link href={item.href} />}>
                      <item.icon />
                      <span>{item.label}</span>
                      {item.label === "Reviews" && pendingReviews > 0 ? (
                        <span className="ml-auto rounded-sm bg-destructive/10 px-1.5 text-[11px] font-medium text-destructive">{pendingReviews}</span>
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent className="px-2 text-sm">
            <p className="font-medium">{companyName}</p>
            <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
              <GitBranch aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0 font-mono">
                <span className="block break-words">{repo}</span>
                <span className="text-muted-foreground/70">{branch}</span>
              </span>
            </p>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 py-3 text-[11px] text-muted-foreground">AI detects · human decides</SidebarFooter>
    </Sidebar>
  );
}
