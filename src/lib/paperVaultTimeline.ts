// Fetch wrapper for server/timelineApi.ts's /api/paper-vault-timeline
// route, which reads scripts/paperVaultCycle.ts's simulated decision log
// (data/paperVaultDecisions.jsonl via executor/paperExecutor.ts). Every
// entry here is SIMULATED: no real vault, no real funds, ever, see
// shared/paperVaultState.ts and scripts/paperVaultConfig.ts's own doc
// comments. Kept in its own module and its own types, never merged with
// src/lib/timeline.ts's real onchain TimelineEntry shape, so a future
// refactor can't accidentally render a paper decision inside the real
// timeline's data path.
export interface PaperVaultDecision {
  vaultId: string;
  strategyVersion: string;
  modelId: string;
  action: string;
  asset?: string;
  amount?: string;
  targetAllocations?: { asset: string; targetWeightBps: number }[];
  confidence: number;
  reasoning: string;
  proposedAt: string;
}

export interface PaperVaultPolicyCheck {
  passed: boolean;
  violations: { code: string; detail: string }[];
  checkedAt: string;
  source: string;
}

export interface PaperVaultTimelineEntry {
  mode: "paper";
  executedAt: string;
  decision: PaperVaultDecision;
  policyCheck: PaperVaultPolicyCheck;
  thinkingText?: string | null;
  thinkingTokens?: number | null;
}

export async function fetchPaperVaultTimeline(): Promise<PaperVaultTimelineEntry[]> {
  const response = await fetch(`/api/paper-vault-timeline`);
  const json = (await response.json()) as { entries?: PaperVaultTimelineEntry[]; error?: string };
  if (!response.ok) throw new Error(json.error ?? `request to /api/paper-vault-timeline failed: HTTP ${response.status}`);
  return json.entries ?? [];
}
