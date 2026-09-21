import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { AnalysisSheet } from "@/components/dashboard/analysis-sheet";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AskSheet } from "@/components/dashboard/ask-sheet";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { SiteHeader } from "@/components/dashboard/site-header";
import { WorkspaceProvider } from "@/components/dashboard/workspace-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { load, shellContext } from "@/lib/dashboard-data";
import type { Investigation, ReviewRecord } from "@/lib/pipeline-types";

export const dynamic = "force-dynamic";

/** Workspace shell: sidebar (nav + investigations + workspace), header (⌘K), agent sheet, analysis sheet, palette, toasts. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await shellContext();
  const [pending, recent] = await Promise.all([
    load<ReviewRecord[]>(ctx, "/api/reviews?status=AWAITING_REVIEW", []),
    load<Investigation[]>(ctx, "/api/investigations?limit=8", []),
  ]);

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <TooltipProvider>
        <WorkspaceProvider health={ctx.health} tenant={{ companyName: ctx.tenant.companyName, repo: ctx.tenant.githubRepo, branch: ctx.tenant.defaultBranch }} recent={recent.data}>
          <div className="bg-background text-foreground">
            <SidebarProvider>
              <AppSidebar pendingReviews={pending.data.length} user={{ login: ctx.session.user.login, name: ctx.session.user.name, image: ctx.session.user.image }} signOut={doSignOut} />
              <SidebarInset className="min-w-0">
                <SiteHeader companyName={ctx.tenant.companyName} />
                <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-6">{children}</main>
              </SidebarInset>
            </SidebarProvider>
            <AskSheet />
            <CommandPalette />
            <AnalysisSheet />
            <Toaster position="bottom-right" />
          </div>
        </WorkspaceProvider>
      </TooltipProvider>
  );
}
