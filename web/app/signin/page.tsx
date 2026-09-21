import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { GitHubButton } from "@/components/auth/github-button";
import "@/components/ui/glass.css";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await auth()) redirect("/connect");
  const { error } = await searchParams;
  return (
    <AuthShell
      title="Connect GitHub"
      lede="Sign in with GitHub to connect the repository that holds your company's policy documents."
      footnote={
        <>
          <p>AfterCircular reads policy documents. It opens issues and pull requests; it never merges them.</p>
          <p className="mt-3">
            New here?{" "}
            <Link href="/signup" className="text-white/80 underline underline-offset-4 hover:text-white">
              Create a workspace
            </Link>
          </p>
        </>
      }
    >
      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-brand/50 bg-brand/15 px-4 py-3 text-sm">
          Sign-in didn&rsquo;t complete ({error}). Try again.
        </p>
      ) : null}
      <GitHubButton label="Continue with GitHub" />
      <p className="mt-4 text-sm text-white/55">You&rsquo;ll pick the exact repository on the next step.</p>
    </AuthShell>
  );
}
