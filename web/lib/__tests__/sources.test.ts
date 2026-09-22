import { describe, expect, it } from "vitest";
import type { DocCard, PolicySource, RegulatorySource } from "@/lib/pipeline-types";
import { cardSources, policySources, regulatorySources, retrievalSources, sourceCounts } from "@/lib/sources";

const REG: RegulatorySource = {
  regulator: "SEBI", source_mode: "LIVE", synthetic: false, title: "Certification Requirements for Distribution of Specialized Investment Funds (SIFs)",
  reference: "HO/24/13/17(1)2026-IMD-POD-1/I/16895/2026", published_date: "2026-07-21",
  detail_url: "https://www.sebi.gov.in/legal/circulars/jul-2026/certification-requirements-for-distribution-of-specialized-investment-funds-sifs-_102986.html",
  pdf_url: "https://www.sebi.gov.in/sebi_data/attachdocs/jul-2026/1784633350069.pdf", document_id: "102986", content_hash: "h", fetched_at: "2026-09-22T05:16:00Z",
};
const POL: Record<string, PolicySource> = {
  "POL-002": { path: "policies/POL-002-distributor-empanelment-and-certification-policy.md", url: "https://github.com/auraCodesKM/nimbus-amc-policies/blob/main/policies/POL-002-distributor-empanelment-and-certification-policy.md", repo: "auraCodesKM/nimbus-amc-policies", branch: "main", fictional: true },
};

describe("regulatory sources", () => {
  it("link every cited section to the exact persisted SEBI page and PDF, never a homepage", () => {
    const s = regulatorySources([{ section: "21.10.1", text: "Any persons" }, { section: "21.10.3", text: "The existing requirement" }], REG);
    expect(s).toHaveLength(2);
    for (const x of s) {
      expect(x.kind).toBe("regulator");
      expect(x.status).toBe("LIVE");
      expect(x.url).toBe(REG.detail_url);
      expect(x.pdf_url).toBe(REG.pdf_url);
      expect(x.domain).toBe("www.sebi.gov.in");
      expect(x.title).toBe(REG.title);
    }
    expect(s.map((x) => x.section)).toEqual(["21.10.1", "21.10.3"]);
  });
  it("never links a synthetic snapshot to sebi.gov.in and has no PDF", () => {
    const s = regulatorySources([{ section: "2.1", text: "x" }], { ...REG, synthetic: true, source_mode: "DEMO_SNAPSHOT", detail_url: "https://example.invalid/sebi/demo/2026/015", pdf_url: null });
    expect(s[0].status).toBe("DEMO_SNAPSHOT");
    expect(s[0].url).toBeNull();
    expect(s[0].pdf_url).toBeNull();
  });
  it("has no url when nothing was persisted (never invents one from a title)", () => {
    const s = regulatorySources([{ section: "1", text: "x" }], null, { label: "SEBI", url: "#" });
    expect(s[0].url).toBeNull();
    expect(s[0].domain).toBeNull();
  });
});

describe("policy sources", () => {
  it("point at the exact GitHub file of the right repository and keep the workspace route", () => {
    const s = policySources([{ doc_id: "POL-002", section: "4.2", text: "must hold NISM Series XIII" }, { doc_id: "POL-002", section: "4.2", text: "dup" }], POL);
    expect(s).toHaveLength(1); // deduplicated by doc+section
    expect(s[0].url).toBe(POL["POL-002"].url);
    expect(s[0].repository).toBe("auraCodesKM/nimbus-amc-policies");
    expect(s[0].path).toBe(POL["POL-002"].path);
    expect(s[0].workspace_href).toBe("/dashboard/policies?open=POL-002");
    expect(s[0].status).toBe("INTERNAL");
  });
  it("fall back to the workspace route only when the run recorded no file", () => {
    const s = policySources([{ doc_id: "POL-009", section: "1", text: "x" }], POL);
    expect(s[0].url).toBeNull();
    expect(s[0].label).toBe("Policy repository");
    expect(s[0].workspace_href).toBe("/dashboard/policies?open=POL-009");
  });
});

describe("retrieval sources", () => {
  it("carry rank, score, commit and no external URL", () => {
    const s = retrievalSources({ retrieved_chunks: [{ chunk_id: "c1", doc_id: "POL-002", title: "Distributor policy", path: "policies/POL-002.md", section: "4.2", text: "t", score: 0.0333, commit_sha: "a84ddcd7e64a" }], metrics: { retrieval: { backend: "azure-ai-search" } } }, POL);
    expect(s[0].label).toBe("Azure AI Search");
    expect(s[0].rank).toBe(1);
    expect(s[0].url).toBeNull();
    expect(s[0].commit_sha).toBe("a84ddcd7e64a");
    expect(s[0].status).toBe("RETRIEVED");
  });
});

describe("card sources", () => {
  it("combine both sides and count them", () => {
    const card = { regulatory_evidence: [{ section: "21.10.1", text: "a" }], policy_evidence: [{ doc_id: "POL-002", section: "4.2", text: "b" }], regulatory_source: REG, policy_sources: POL, source: "SEBI", url: REG.detail_url, title: REG.title } as unknown as DocCard;
    const s = cardSources(card);
    expect(sourceCounts(s)).toMatchObject({ total: 2, regulatory: 1, internal: 1 });
    expect(s.find((x) => x.kind === "policy")?.url).toContain("github.com/auraCodesKM/nimbus-amc-policies/blob/main/");
  });
});

describe("site icons", () => {
  it("SEBI and GitHub sources carry the site's own icon; a snapshot or unlinked source carries none", () => {
    const live = regulatorySources([{ section: "1", text: "x" }], REG)[0];
    expect(live.favicon_url).toBe("https://www.sebi.gov.in/images/icons/sebi-icon.png");
    expect(live.retrieved_at).toBe(REG.fetched_at);
    const gh = policySources([{ doc_id: "POL-002", section: "4.2", text: "y" }], POL)[0];
    expect(gh.favicon_url).toBe("https://github.com/favicon.ico");
    const snap = regulatorySources([{ section: "1", text: "x" }], { ...REG, synthetic: true, source_mode: "DEMO_SNAPSHOT", detail_url: "https://example.invalid/x", pdf_url: null })[0];
    expect(snap.favicon_url).toBeNull();
    expect(policySources([{ doc_id: "POL-009", section: "1", text: "z" }], POL)[0].favicon_url).toBeNull();
  });
});
