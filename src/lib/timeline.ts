// Fetch wrapper for server/timelineApi.ts, the read-only wrapper around
// buildDecisionTimeline (server/indexer/eventIndexer.ts). Types mirror
// server/decisionPipeline.ts's DecisionPipelineEntry and
// server/db/eventStore.ts's IndexedEvent shapes as they cross the JSON
// boundary (bigint fields already stringified server-side).
export interface TimelineDecision {
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

export interface TimelineQueued {
  decision: TimelineDecision;
  status: string;
  queuedAt: string;
  expiresAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface TimelinePolicyCheck {
  passed: boolean;
  violations: { code: string; detail: string }[];
  checkedAt: string;
  source: string;
}

export interface TimelineAnomalyFlag {
  code: string;
  detail: string;
}

export interface TimelineEntry {
  decisionId: string;
  queued: TimelineQueued;
  policyCheck: TimelinePolicyCheck;
  anomalyFlags: TimelineAnomalyFlag[];
  // Absent for any decision enqueued before this field existed, see
  // server/decisionPipeline.ts's own doc comment.
  thinkingText?: string | null;
  thinkingTokens?: number | null;
  priority: string;
  resolvedBy?: string;
  resolvedAt?: string;
  txHash?: string;
}

export interface TimelineIndexedEvent {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: string;
  transactionHash: string;
  indexedAt: string;
}

export interface DecisionTimelineEntry {
  entry: TimelineEntry;
  onchainEvent?: TimelineIndexedEvent;
}

export interface DecisionTimelineResult {
  entries: DecisionTimelineEntry[];
  // Paused/Unpaused/AutoPaused/AutoPauseBountyCallFailed for this vault's
  // policy contract. Not sensitive (PAUSER_ROLE/GOVERNANCE_ROLE/
  // ADMIN_ROLE are public onchain roles, already listed in
  // docs/deployments.md), shown separately from `entries` because these
  // events are emitted by VaultPolicy directly and are never tied to any
  // specific AI decision's own transaction, unlike DecisionExecuted.
  vaultEvents: TimelineIndexedEvent[];
}

export async function fetchDecisionTimeline(vaultId: string, policyId: string): Promise<DecisionTimelineResult> {
  const response = await fetch(`/api/timeline?vaultId=${encodeURIComponent(vaultId)}&policyId=${encodeURIComponent(policyId)}`);
  const json = (await response.json()) as { entries?: DecisionTimelineEntry[]; vaultEvents?: TimelineIndexedEvent[]; error?: string };
  if (!response.ok) throw new Error(json.error ?? `request to /api/timeline failed: HTTP ${response.status}`);
  return { entries: json.entries ?? [], vaultEvents: json.vaultEvents ?? [] };
}
