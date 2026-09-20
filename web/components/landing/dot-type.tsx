/**
 * LED dot type. 7-row bitmap glyphs rendered as filled circles.
 * Geometry matches the reference: pitchY 4, gap 1 between glyphs,
 * circle at (x + col*pitchX + 1.55, row*pitchY + 1.55), viewBox height 28.
 */
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["010", "110", "010", "010", "010", "010", "111"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ".": ["0", "0", "0", "0", "0", "0", "1"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  c: ["00000", "00000", "01110", "10001", "10000", "10001", "01110"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  g: ["00000", "00000", "01111", "10001", "01111", "00001", "01110"],
  i: ["1", "0", "1", "1", "1", "1", "1"],
  l: ["10", "10", "10", "10", "10", "10", "01"],
  n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  t: ["010", "010", "111", "010", "010", "010", "001"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
};

const PITCH_Y = 4;
const GAP = 1;
const ROWS = 7;

export type DotVariant = "word" | "metric" | "metric-context";

const variantSpec: Record<DotVariant, { pitchX: number; r: number }> = {
  word: { pitchX: 4, r: 1.8 },
  metric: { pitchX: 5, r: 1.55 },
  "metric-context": { pitchX: 5, r: 2.32 },
};

export function dotLayout(text: string, variant: DotVariant) {
  const { pitchX, r } = variantSpec[variant];
  const circles: { cx: number; cy: number }[] = [];
  let x = 0;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    const cols = glyph[0].length;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < cols; col++) {
        if (glyph[row][col] === "1") circles.push({ cx: x + col * pitchX + 1.55, cy: row * PITCH_Y + 1.55 });
      }
    }
    x += cols * pitchX + GAP;
  }
  return { circles, width: x, height: ROWS * PITCH_Y, r };
}

export function DotSvg({ text, variant, className = "dot-svg" }: { text: string; variant: DotVariant; className?: string }) {
  const { circles, width, height, r } = dotLayout(text, variant);
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} fill="currentColor" aria-hidden>
      {circles.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={r} />
      ))}
    </svg>
  );
}

/** Reference: "Intelligent" (167 viewBox units) renders at 4.851em. Width scales with glyph run. */
export function dotWordWidthEm(text: string) {
  return (dotLayout(text, "word").width / 167) * 4.851;
}

/** Reference: "118" (78 units) renders at 31.2% of card width. Keeps dot size constant across metrics. */
export function dotNumberWidthPct(text: string, variant: DotVariant, refPct = 31.2, refUnits = 78) {
  return (dotLayout(text, variant).width / refUnits) * refPct;
}
