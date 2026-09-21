"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          success: "!border-success/40 !bg-[color-mix(in_oklab,var(--success)_12%,var(--popover))] !text-success [&_[data-description]]:!text-success/80",
          error: "!border-destructive/40 !bg-[color-mix(in_oklab,var(--destructive)_12%,var(--popover))] !text-destructive [&_[data-description]]:!text-destructive/80",
          warning: "!border-warning/40 !bg-[color-mix(in_oklab,var(--warning)_12%,var(--popover))] !text-warning [&_[data-description]]:!text-warning/80",
          info: "!border-info/40 !bg-[color-mix(in_oklab,var(--info)_12%,var(--popover))] !text-info [&_[data-description]]:!text-info/80",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
