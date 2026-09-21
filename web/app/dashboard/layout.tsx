import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { signOut } from "@/auth";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { SiteHeader } from "@/components/dashboard/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { load, shellContext } from "@/lib/dashboard-data";
import type { ReviewRecord } from "@/lib/pipeline-types";

export const dynamic = "force-dynamic";

/** Application shell: auth + tenant guard, sidebar, header, theme, toasts. Pages render inside <SidebarInset>. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await shellContext();
  const { data: pending } = await load<ReviewRecord[]>(ctx, "/api/reviews?status=AWAITING_REVIEW", []);

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="ac-theme" disableTransitionOnChange>
      <TooltipProvider>
        <div className="bg-background text-foreground">
          <SidebarProvider>
            <AppSidebar companyName={ctx.tenant.companyName} repo={ctx.tenant.githubRepo} branch={ctx.tenant.defaultBranch} pendingReviews={pending.length} />
            <SidebarInset className="min-w-0">
              <SiteHeader companyName={ctx.tenant.companyName} login={ctx.session.user.login} name={ctx.session.user.name} image={ctx.session.user.image} signOut={doSignOut} />
              <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">{children}</main>
            </SidebarInset>
          </SidebarProvider>
          <Toaster position="bottom-right" />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
