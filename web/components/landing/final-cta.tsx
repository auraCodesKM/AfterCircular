import Link from "next/link";
import { Mark } from "@/components/brand/aftercircular-logo";
import { Reveal } from "@/components/ui/reveal";
import { Glass } from "@/components/ui/glass";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="py-16 md:py-24">
      <Reveal className="container-x">
        <Glass tone="ink" bodyClassName="flex flex-col items-center px-6 py-16 text-center md:py-24">
          <Mark size={56} animated className="text-white" />
          <h2 id="cta-title" className="display mt-8 text-4xl sm:text-5xl md:text-6xl">
            Turn regulatory change into action.
          </h2>
          <div className="mt-10 flex items-center gap-2">
            <Link href="/signin" className="pill pill--ghost">
              Sign in
            </Link>
            <Link href="/signup" className="pill">
              Sign up
            </Link>
          </div>
        </Glass>
      </Reveal>
    </section>
  );
}
