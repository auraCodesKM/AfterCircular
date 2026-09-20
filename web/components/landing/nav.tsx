import Link from "next/link";
import "./nav.css";
import { Logo } from "@/components/brand/aftercircular-logo";
import { ButtonLink } from "@/components/ui/button";

const links = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#evidence", label: "Evidence" },
  { href: "#security", label: "Security" },
];

export function Nav() {
  return (
    <header className="nav-wrap">
      <div className="nav-pill">
        <Logo animated compact size={26} />

        <nav aria-label="Primary" className="nav-links">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="nav-cta">
          <ButtonLink href="/signin" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Sign in
          </ButtonLink>
          <ButtonLink href="/signup" variant="primary" size="sm">
            Sign up
          </ButtonLink>
          <details className="nav-menu">
            <summary aria-label="Open menu">
              <span aria-hidden className="flex flex-col gap-[5px]">
                <span className="block h-px w-4 bg-ink" />
                <span className="block h-px w-4 bg-ink" />
              </span>
            </summary>
            <nav aria-label="Primary, mobile" className="nav-menu__panel">
              {links.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ))}
              <Link href="/signin" className="sm:hidden">
                Sign in
              </Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
