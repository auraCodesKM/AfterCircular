import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { GitHubButton } from "@/components/auth/github-button";
import "@/components/ui/glass.css";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage() {
  if (await auth()) redirect("/connect");
  return (
    <AuthShell
      title="Create your workspace"
      lede="One workspace per company. Your policy repository, your search index, your audit log — isolated from every other tenant."
      footnote={
        <>
          <p>We request the GitHub `repo` scope to read private policy documents. Nothing is written without a human approval.</p>
          <p className="mt-3">
            Already connected?{" "}
            <Link href="/signin" className="text-white/80 underline underline-offset-4 hover:text-white">
              Sign in
            </Link>
          </p>
        </>
      }
    >
      <GitHubButton label="Continue with GitHub" />
      <p className="mt-4 text-sm text-white/55">Next: name your company and choose its policy repository.</p>
    </AuthShell>
  );
}
