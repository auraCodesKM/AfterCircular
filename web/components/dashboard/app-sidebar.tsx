"use client";

import { Activity, BookOpen, ChevronsUpDown, ClipboardCheck, Cpu, FileText, GitBranch, LayoutDashboard, LogOut, Plus, Search, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/aftercircular-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { useWorkspace } from "./workspace-provider";

export const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/documents", label: "Documents", icon: FileText },
  { href: "/dashboard/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/dashboard/policies", label: "Policies", icon: BookOpen },
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
  { href: "/dashboard/models", label: "Models", icon: Cpu },
] as const;

type Props = { pendingReviews: number; user: { login: string; name?: string | null; image?: string | null }; signOut: () => Promise<void> };

export function AppSidebar({ pendingReviews, user, signOut }: Props) {
  const pathname = usePathname();
  const { palette, recent, tenant } = useWorkspace();
  const { isMobile, setOpenMobile } = useSidebar();
  const go = () => isMobile && setOpenMobile(false);
  const initials = (user.name || user.login).slice(0, 2).toUpperCase();

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-3 px-3 pt-3">
        <Logo href="/dashboard" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/dashboard/ask" onClick={go} />} className="border border-border bg-background hover:bg-muted">
              <Plus />
              <span>New investigation</span>
              <kbd className="ml-auto hidden font-mono text-[10px] text-muted-foreground sm:inline">⌘K</kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton isActive={active} render={<Link href={item.href} onClick={go} />}>
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
        <SidebarGroup>
          <SidebarGroupLabel>Recent investigations</SidebarGroupLabel>
          <SidebarGroupContent>
            {recent.length ? (
              <SidebarMenu>
                {recent.slice(0, 6).map((inv) => (
                  <SidebarMenuItem key={inv.id}>
                    <SidebarMenuButton size="sm" isActive={pathname.endsWith(inv.id)} render={<Link href={`/dashboard/ask?open=${inv.id}`} onClick={go} />} title={inv.question}>
                      <Search className="text-muted-foreground" />
                      <span className="truncate">{inv.question}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              <button type="button" onClick={() => { go(); palette.setOpen(true); }} className="px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground">
                Nothing yet — ask a question or press ⌘K.
              </button>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="px-2 pb-1.5">
          <p className="truncate text-sm font-medium">{tenant.companyName}</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground" title={`${tenant.repo} · ${tenant.branch}`}>
            <GitBranch aria-hidden className="size-3 shrink-0" />
            <span className="truncate font-mono">{tenant.repo}</span>
          </p>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-[popup-open]:bg-sidebar-accent" />}>
                <Avatar size="sm">
                  {user.image ? <AvatarImage src={user.image} alt="" /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm">@{user.login}</span>
                  <span className="truncate text-[11px] text-muted-foreground">GitHub connected</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium">{user.name || `@${user.login}`}</p>
                  <p className="text-xs font-normal text-muted-foreground">@{user.login} · GitHub</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/connect" />}>
                  <GitBranch />
                  Change repository
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/dashboard/profile" />}>
                  <User />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => signOut()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
