import { describe, expect, it } from "vitest";
import { composeAnswer } from "@/lib/answer-compose";
import conflict from "@/lib/__tests__/fixtures/nimbus_conflict.json";
import jev from "@/lib/__tests__/fixtures/nimbus_jev.json";

// fixtures = the stored Nimbus 102986 investigations exactly as the backend persisted them (no edits)
describe("Jev assessment (stored Nimbus investigation)", () => {
  const md = composeAnswer(jev as never).markdown;
  it("renders every persisted Jev fact — nothing 'not recorded' that the trace holds", () => {
    for (const needle of ["YES", "90% confidence", "6 / 10", "| Conflict | 2 |", "| Uncertain | 2 |", "| Satisfied | 1 |", "| Not addressed | 8 |", "2 excerpts rejected", "Agreed with Microsoft Foundry", "1 conflict pair remained", "Jev 1.13.0 · 55 typed judgments", "no Jev judgment authorizes an action"]) {
      expect(md, needle).toContain(needle);
    }
    expect(md).not.toMatch(/undefined|not recorded/);
  });
});

describe("conflict answer (stored Nimbus investigation)", () => {
  const c = composeAnswer(conflict as never);
  it("keeps the answer hierarchy", () => {
    for (const h of ["## Conflict detected", "### Why", "### Regulatory requirement", "### Internal policy", "### Requirement mismatch", "### Impact"]) expect(c.markdown).toContain(h);
  });
  it("citation markers are distinct [n] tokens that each map to exactly one source row", () => {
    const used = Array.from(c.markdown.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]));
    expect(used.length).toBeGreaterThan(0);
    expect(c.markdown).not.toMatch(/\d\]\[\d/); // never "[1][2]" glued together
    expect(c.markdown).not.toMatch(/\b1234\b|\b123\b|\b12\b(?![.:/])/); // never a bare glued marker run
    for (const n of used) expect(c.sources[n - 1], `source ${n}`).toBeDefined();
    expect(c.sources.map((s) => `${s.kind} ${s.section}`)).toEqual(["regulator 21.10.1", "regulator 21.10.3", "regulator 21.10.4", "policy 4.2 Specialized Investment Fund strategies"]);
  });
  it("truncation never cuts inside a marker", () => {
    for (const line of c.markdown.split("\n")) if (line.includes("…")) expect(line).toMatch(/…(\s\[\d+\])*(\s\|.*)?$|…[^[]*$/);
  });
});

// the two stored answers that produced "Encountered two children with the same key, `reg-0-header`" in the browser
import multi from "@/lib/__tests__/fixtures/nimbus_multi_6.json";
import prioritize from "@/lib/__tests__/fixtures/nimbus_prioritize_4.json";
import type { DocCard } from "@/lib/pipeline-types";
import { cardSources } from "@/lib/sources";

describe("answers citing several circulars (stored Nimbus investigations)", () => {
  for (const [name, inv] of [["6 circulars", multi], ["4 circulars", prioritize]] as const) {
    it(`${name}: every rendered source has a unique key`, () => {
      const ids = composeAnswer(inv as never).sources.map((s) => s.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      const all = (inv.answer.documents as unknown as DocCard[]).flatMap((d) => cardSources(d).map((s) => s.id));
      expect(new Set(all).size).toBe(all.length);
    });
  }
});
