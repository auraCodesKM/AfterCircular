import type { ComponentProps, ReactNode } from "react";
import "./glass.css";

export type GlassTone = "rose" | "plum" | "ember" | "ink" | "paper";

type GlassProps = ComponentProps<"div"> & {
  tone?: GlassTone;
  /** Applied to the inner body (padding, layout). */
  bodyClassName?: string;
  children: ReactNode;
};

/** Hero-card surface: rim, sheen, grain. Needs <FilterDefs /> (#cardNoise) on the page. */
export function Glass({ tone = "paper", className = "", bodyClassName = "", children, ...rest }: GlassProps) {
  return (
    <div className={`glass glass--${tone} ${className}`} {...rest}>
      <svg className="glass__grain" viewBox="0 0 429 554" preserveAspectRatio="none" aria-hidden>
        <rect width="429" height="554" filter="url(#cardNoise)" />
      </svg>
      <div className={`glass__body ${bodyClassName}`}>{children}</div>
    </div>
  );
}
