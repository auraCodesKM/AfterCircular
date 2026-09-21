import type { Metadata } from "next";
import { Suspense } from "react";
import { InvestigationChat } from "@/components/dashboard/investigation-chat";
import { shellContext } from "@/lib/dashboard-data";

export const metadata: Metadata = { title: "Ask AfterCircular" };

export default async function AskPage() {
  const ctx = await shellContext();
  return (
    <Suspense>
      <InvestigationChat initialLogin={ctx.session.user.login} avatar={ctx.session.user.image} />
    </Suspense>
  );
}
