import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { Problem } from "@/components/landing/problem";
import { Workflow } from "@/components/landing/workflow";
import { Evidence } from "@/components/landing/evidence";
import { ModelIntelligence } from "@/components/landing/model-intelligence";
import { Security } from "@/components/landing/security";
import { ResponsibleAI } from "@/components/landing/responsible-ai";
import { FinalCta } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";

export default function Home() {
  return (
    <>
      <a
        href="#product"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>
      <Nav />
      <main className="flex-1">
        <Hero />
        <Problem />
        <Workflow />
        <Evidence />
        <ModelIntelligence />
        <Security />
        <ResponsibleAI />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
