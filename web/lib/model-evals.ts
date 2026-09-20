/**
 * Model evaluation results. Populated from Foundry evaluation runs over the
 * golden dataset in `evals/`. Empty until real measurements exist — the UI
 * renders a pending state and never shows fabricated numbers.
 */
export type ModelEvalResult = {
  model: string;
  task: "obligation_extraction" | "impact_gate" | "impact_analysis" | "memo_generation";
  quality: number; // 0–1, golden-set accuracy
  latencyMs: number; // median
  costPer1kRuns: number; // USD
  structuredOutputSuccess: number; // 0–1
  toolCallSuccess: number; // 0–1
  evidenceAccuracy: number; // 0–1
};

export const modelEvalResults: ModelEvalResult[] = [];

export const taskModelConfig = `tasks:
  obligation_extraction: { model: cost-model }
  impact_gate:           { model: cheapest-acceptable }
  impact_analysis:       { model: quality-model }
  memo_generation:       { model: balanced-model }`;
