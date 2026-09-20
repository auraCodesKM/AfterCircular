import type { CSSProperties, ReactNode } from "react";
import "./hero.css";
import { DotSvg, dotNumberWidthPct, dotWordWidthEm, type DotVariant } from "@/components/landing/dot-type";
import { CardGrain, ConnectionsMap, ContextBackdrop, ContextWindow, FilterDefs, Gauge, PaperTexture } from "@/components/landing/hero-art";
import { EntranceController } from "@/components/landing/entrance";

const CDN_IMG = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P";
const CDN_VID = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P";

const stage = {
  wide: { poster: `${CDN_IMG}/5c3ec08f-2dbf-4c0a-8588-f6106a789443.webp`, src: `${CDN_VID}/hf_20260826_125226_45cb4f38-aa7e-47e1-885d-ae0b69745369.mp4` },
  narrow: { poster: `${CDN_IMG}/0f4926a4-e660-4df2-9195-2bfb3e341bdd.webp`, src: `${CDN_VID}/hf_20260826_125242_daae1570-386d-4bd5-8896-80499e2371e0.mp4` },
};

type Card = {
  key: "speed" | "context" | "connections";
  title: [string, string];
  metric: string;
  unit?: string;
  caption: [string, string];
  href: string;
  poster: string;
  src: string;
  delay: string;
  dotVariant: DotVariant;
  dotRef: [number, number]; // [reference %, reference viewBox units]
  art: ReactNode;
};

const cards: Card[] = [
  {
    key: "speed",
    title: ["Continuous Monitoring", "Regulatory Publications"],
    metric: "24/7",
    caption: ["Regulatory sources", "continuously monitored"],
    href: "#watch",
    poster: `${CDN_IMG}/167977c6-8539-46b1-9a15-8dba566f50b8.png`,
    src: `${CDN_VID}/hf_20260826_130045_1a612b69-4854-4b34-8043-ccb91f2c60af.mp4`,
    delay: ".46s",
    dotVariant: "metric",
    dotRef: [31.2, 78],
    art: <Gauge />,
  },
  {
    key: "context",
    title: ["Evidence-Grounded Analysis", "Policy Conflict Detection"],
    metric: "100",
    unit: "%",
    caption: ["Evidence cited", "per decision"],
    href: "#evidence",
    poster: `${CDN_IMG}/0446d1d5-e65e-4db5-8090-3e30d09afc43.png`,
    src: `${CDN_VID}/hf_20260826_130054_dd005674-d693-4d81-80a5-357f7f10b3a3.mp4`,
    delay: ".58s",
    dotVariant: "metric-context",
    dotRef: [30.5, 58],
    art: (
      <>
        <ContextBackdrop />
        <ContextWindow />
      </>
    ),
  },
  {
    key: "connections",
    title: ["Human-Controlled Action", "Approval Before Execution"],
    metric: "1",
    unit: "gate",
    caption: ["Human approval", "before execution"],
    href: "#act",
    poster: `${CDN_IMG}/da8d0242-4dee-4f6d-813f-a5887e86ad77.png`,
    src: `${CDN_VID}/hf_20260826_130103_7550f407-f14b-40a6-9616-7a26d7a8bd9f.mp4`,
    delay: ".70s",
    dotVariant: "metric",
    dotRef: [23, 43],
    art: <ConnectionsMap />,
  },
];

// Runs before first paint so the entrance choreography starts from its hidden state.
const entranceScript = `document.documentElement.classList.add("entrance-active");window.__entranceFailsafe=setTimeout(function(){document.documentElement.classList.remove("entrance-active")},3200);`;

export function Hero() {
  const dotWord = "action";
  return (
    <section id="product" className="stage" aria-labelledby="hero-title">
      <script dangerouslySetInnerHTML={{ __html: entranceScript }} />
      <EntranceController />

      <video className="stage-motion stage-motion--wide" autoPlay muted loop playsInline preload="auto" aria-hidden poster={stage.wide.poster} src={stage.wide.src} />
      <video className="stage-motion stage-motion--narrow" autoPlay muted loop playsInline preload="none" aria-hidden poster={stage.narrow.poster} src={stage.narrow.src} />
      <PaperTexture />
      <FilterDefs />

      <header className="masthead">
        <h1 id="hero-title" className="headline">
          <span className="headline__line">Turn regulatory change</span>
          <span className="headline__line">
            into
            <span
              className="dot-word"
              role="img"
              aria-label={dotWord}
              style={{ "--dot-word-w": `${dotWordWidthEm(dotWord).toFixed(3)}em` } as CSSProperties}
            >
              <DotSvg text={dotWord} variant="word" />
            </span>
          </span>
        </h1>
        <p className="intro">
          AfterCircular continuously monitors regulatory publications,
          <br className="desktop-break" /> detects policy conflicts, provides evidence-grounded analysis,
          <br className="desktop-break" /> and routes every change through a human approval layer.
        </p>
      </header>

      <div className="cards" role="list" aria-label="Product capabilities">
        {cards.map((c) => (
          <article
            key={c.key}
            role="listitem"
            className={`card card--${c.key}`}
            style={{ "--entrance-delay": c.delay } as CSSProperties}
            aria-labelledby={`card-${c.key}`}
          >
            <video className="card__media" autoPlay muted loop playsInline preload="auto" aria-hidden poster={c.poster} src={c.src} />
            <CardGrain />
            <h2 id={`card-${c.key}`} className="card__title">
              {c.title[0]}
              <br />
              {c.title[1]}
            </h2>
            {c.art}
            <div
              className={`metric metric--${c.key}`}
              style={{ "--dot-number-w": `${dotNumberWidthPct(c.metric, c.dotVariant, c.dotRef[0], c.dotRef[1]).toFixed(2)}%` } as CSSProperties}
            >
              <span className="dot-number" role="img" aria-label={c.metric}>
                <DotSvg text={c.metric} variant={c.dotVariant} />
              </span>
              {c.unit ? <span className="metric__unit">{c.unit}</span> : null}
            </div>
            <p className="caption">
              {c.caption[0]}
              <br />
              {c.caption[1]}
            </p>
            <a className="learn-more" href={c.href} aria-label={`Explore ${c.title[0]}`}>
              Explore
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
