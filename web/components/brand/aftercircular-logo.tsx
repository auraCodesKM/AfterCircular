import Link from "next/link";

type MarkProps = {
  size?: number;
  animated?: boolean;
  className?: string;
  /** Set when the mark stands alone and carries meaning. Omit when decorative. */
  title?: string;
};

/**
 * AfterCircular mark.
 * Open loop = continuous regulatory change. The loop flows into the A (the system)
 * and stays open where change enters — the accent node. The bar of the A is the
 * human approval gate. Geometry is shared with /public/brand/*.svg.
 */
export function Mark({ size = 32, animated = false, className, title }: MarkProps) {
  const ring = "M44 52.78A24 24 0 1 1 55.64 36.17";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d={ring} stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      {animated ? (
        <path
          className="ac-trace"
          pathLength={100}
          d={ring}
          stroke="var(--accent)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      ) : null}
      <circle
        className={animated ? "ac-node" : undefined}
        cx="51.66"
        cy="45.77"
        r="4.25"
        fill="var(--accent)"
      />
      <path
        d="M20 52.78L32 14L44 52.78M24.57 38H39.43"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type LogoProps = {
  size?: number;
  animated?: boolean;
  href?: string;
  className?: string;
  /** Hide the wordmark below the `sm` breakpoint (mark stays). */
  compact?: boolean;
};

/** Mark + wordmark. Renders as a link to `href` (default "/"). */
export function Logo({ size = 28, animated = false, href = "/", className = "", compact = false }: LogoProps) {
  return (
    <Link
      href={href}
      aria-label="AfterCircular — home"
      className={`inline-flex items-center gap-2.5 ${className}`}
    >
      <Mark size={size} animated={animated} />
      <span
        className={`font-medium tracking-[-0.02em] ${compact ? "hidden sm:inline" : ""}`}
        style={{ fontSize: size * 0.68, lineHeight: 1 }}
      >
        AfterCircular
      </span>
    </Link>
  );
}
