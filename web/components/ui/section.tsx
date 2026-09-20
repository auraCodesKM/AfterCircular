import type { ReactNode } from "react";
import { Reveal } from "@/components/ui/reveal";

type SectionProps = {
  id: string;
  index: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ id, index, eyebrow, title, lede, children, className = "" }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-24 py-16 md:py-24 ${className}`}>
      <div className="container-x">
        <Reveal className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-12">
          <div>
            <p className="eyebrow flex items-center gap-3">
              <span className="text-ink">{index}</span>
              <span aria-hidden className="h-px w-6 bg-line-strong" />
              <span>{eyebrow}</span>
            </p>
            <h2 id={`${id}-title`} className="display mt-4 text-[2rem] sm:text-4xl md:text-[2.75rem]">
              {title}
            </h2>
          </div>
          {lede ? <p className="max-w-md text-[1rem] leading-relaxed text-ink-2 md:text-right">{lede}</p> : null}
        </Reveal>
        <div className="mt-10 md:mt-12">{children}</div>
      </div>
    </section>
  );
}
