import { NotFoundGlitch } from "@/components/motion/not-found/glitch";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <NotFoundGlitch title="Page not found" description="This page moved, was never published, or the circular it referred to has not been processed." homeHref="/" homeLabel="Back home" browseHref="/dashboard" browseLabel="Open workspace" />
    </div>
  );
}
