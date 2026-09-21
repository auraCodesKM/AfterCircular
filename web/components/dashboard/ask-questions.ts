/** Ready questions for the ask dock and the ask sheet, chosen by where the reader is. Every question is self-contained so the router can answer it from records. */
const BY_ROUTE: [RegExp, string[]][] = [
  [/^\/dashboard\/documents\/[^/]+/, ["Why is the latest conflict a conflict?", "Which policy does the latest conflict affect?", "What must we do before the effective date?"]],
  [/^\/dashboard\/documents/, ["Which circulars conflict with our policies?", "What changed in the latest SEBI publication?", "Which circulars are not applicable to us?"]],
  [/^\/dashboard\/reviews/, ["What needs my review?", "What was approved recently?", "Which circulars conflict with our policies?"]],
  [/^\/dashboard\/policies/, ["Which circulars affect POL-001?", "Show POL-001", "Which policies are affected by recent circulars?"]],
  [/^\/dashboard\/activity/, ["What happened in the last scan?", "Who approved what?", "Did any scan fail?"]],
  [/^\/dashboard\/models/, ["Which model handles alignment?", "How is Jev configured?", "What changed in the latest scan?"]],
  [/^\/dashboard\/profile/, ["What have I approved?", "What needs my review?", "What changed in the latest scan?"]],
  [/^\/dashboard\/investigations/, ["What needs my review?", "Which circulars conflict with our policies?", "What changed in the latest scan?"]],
];
const DEFAULT = ["What changed in the latest scan?", "Which circulars conflict with our policies?", "What needs my review?"];

export function questionsFor(pathname: string): string[] {
  return BY_ROUTE.find(([re]) => re.test(pathname))?.[1] ?? DEFAULT;
}
