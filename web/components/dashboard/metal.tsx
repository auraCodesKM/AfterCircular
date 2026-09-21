"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import type { ComponentProps, ReactNode } from "react";

/** Liquid-metal accents (WebGL2; falls back to the plain child). Client-only, theme pinned to the app theme. */
const MetalFxDyn = dynamic(() => import("metal-fx").then((m) => m.MetalFx), { ssr: false, loading: () => null });
const MetalBadgeDyn = dynamic(() => import("metal-fx").then((m) => m.MetalBadge), { ssr: false, loading: () => null });

type Theme = "light" | "dark";

function useAppTheme(): Theme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? "dark" : "light";
}

export function MetalRing({ children, ...props }: Omit<ComponentProps<typeof MetalFxDyn>, "theme" | "children"> & { children: ReactNode }) {
  const theme = useAppTheme();
  return (
    <MetalFxDyn preset="chromatic" variant="circle" innerShadow strength={0.9} theme={theme} {...props}>
      {children}
    </MetalFxDyn>
  );
}

export function MetalTag({ children, strength = 0.8 }: { children: string; strength?: number }) {
  const theme = useAppTheme();
  return (
    <span className="inline-flex text-[10px] font-medium">
      <MetalBadgeDyn theme={theme} strength={strength}>
        {children}
      </MetalBadgeDyn>
    </span>
  );
}
