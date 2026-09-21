import Link from "next/link";
import { Logo } from "@/components/brand/aftercircular-logo";

export function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <div className="container-x flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <Logo size={22} />
          <p className="text-sm text-ink-3">From regulatory change to compliance action.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
            {[
              ["#product", "Product"],
              ["#how-it-works", "How it works"],
              ["#evidence", "Evidence"],
              ["#security", "Security"],
              ["#responsible-ai", "Responsible AI"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="transition-colors hover:text-ink">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-xs text-ink-3">© {new Date().getFullYear()} AfterCircular</p>
      </div>
    </footer>
  );
}
