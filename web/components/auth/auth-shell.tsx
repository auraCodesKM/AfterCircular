import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, Mark } from "@/components/brand/aftercircular-logo";

type AuthShellProps = {
  title: string;
  lede: string;
  children: ReactNode;
  footnote?: ReactNode;
};

/** Dark split: form on the left, full-bleed artwork on the right. */
export function AuthShell({ title, lede, children, footnote }: AuthShellProps) {
  return (
    <div className="grid min-h-dvh bg-[#0a0a0a] text-[#f2f1ee] lg:grid-cols-[minmax(0,42%)_1fr]">
      <main className="flex flex-col px-6 py-6 sm:px-10 lg:px-14 lg:py-8">
        <div className="flex items-center justify-between">
          <Logo className="text-[#f2f1ee]" />
          <Link href="/" className="text-sm text-white/60 transition-colors hover:text-white">
            Back to home
          </Link>
        </div>

        <div className="my-auto flex w-full max-w-md flex-col py-16">
          <Mark size={72} animated className="text-[#f2f1ee]" />
          <h1 className="display mt-8 text-4xl sm:text-[2.75rem]">{title}</h1>
          <p className="mt-4 text-[1.05rem] leading-relaxed text-white/65">{lede}</p>
          <div className="mt-8">{children}</div>
          {footnote ? <div className="mt-6 text-sm text-white/45">{footnote}</div> : null}
        </div>

        <div className="flex items-center justify-between text-xs text-white/40">
          <span>© {new Date().getFullYear()} AfterCircular</span>
          <span>From regulatory change to compliance action.</span>
        </div>
      </main>

      <aside aria-hidden className="relative hidden overflow-hidden lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element -- static full-bleed art, no layout shift */}
        <img src="/auth/bg1.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a]/40 to-transparent" />
      </aside>
    </div>
  );
}
