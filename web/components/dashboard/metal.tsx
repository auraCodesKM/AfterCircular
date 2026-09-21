"use client";

import { MetalBadge, MetalFx, type MetalFxProps } from "metal-fx";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

/** Liquid-metal accents. metal-fx is SSR-safe (transparent placeholder until hydration) and falls back to the plain child without WebGL2. */
function useAppTheme(): "light" | "dark" {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? "dark" : "light";
}

export function MetalRing({ children, ...props }: Omit<MetalFxProps, "theme" | "children"> & { children: ReactNode }) {
  const theme = useAppTheme();
  return (
    <MetalFx preset="chromatic" variant="circle" innerShadow strength={1} theme={theme} {...props}>
      {children}
    </MetalFx>
  );
}

export function MetalTag({ children, strength = 0.9 }: { children: string; strength?: number }) {
  const theme = useAppTheme();
  return (
    <MetalBadge theme={theme} strength={strength}>
      {children}
    </MetalBadge>
  );
}
