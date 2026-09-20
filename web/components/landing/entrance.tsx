"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __entranceFailsafe?: ReturnType<typeof setTimeout>;
  }
}

/** Ends the one-shot entrance once the last control has settled (or immediately under reduced motion). */
export function EntranceController() {
  useEffect(() => {
    const root = document.documentElement;
    const finish = () => {
      clearTimeout(window.__entranceFailsafe);
      root.classList.remove("entrance-active");
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const target = document.querySelector<HTMLElement>(
      mobile ? ".card--speed .learn-more" : ".card--connections .learn-more",
    );
    if (!target) {
      finish();
      return;
    }
    target.addEventListener("animationend", finish, { once: true });
    return () => target.removeEventListener("animationend", finish);
  }, []);
  return null;
}
