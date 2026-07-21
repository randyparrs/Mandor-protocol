// Generated from shared/decision.ts's VaultDecision shape, not hand-written
// twice, per docs/architecture.md. Uses zod/v4 specifically (not the top
// level zod v3 export): zodOutputFormat's internal z.toJSONSchema call only
// accepts zod/v4-shaped schemas, verified against the installed
// @anthropic-ai/sdk (0.110.0) source directly, not assumed.
import { z } from "zod/v4";

export const DecisionActionSchema = z.enum([
  "HOLD",
  "REBALANCE",
  "ENTER",
  "EXIT",
  "EMERGENCY_EXIT_TO_STABLE",
  // v3 (yield-seeking LP vault) only, see shared/decision.ts's own doc
  // comment for why these five stay granular.
  "LP_OPEN",
  "LP_INCREASE",
  "LP_DECREASE",
  "LP_COLLECT",
  "LP_CLOSE",
  // v4 (cross-chain lending vault) only, see shared/decision.ts's own doc
  // comment for why these stay two separate actions.
  "BRIDGE_DEPOSIT",
  "BRIDGE_WITHDRAW",
]);

export const TargetAllocationSchema = z.object({
  asset: z.string(),
  targetWeightBps: z.number().int().min(0).max(10000),
});

// This is deliberately narrower than shared/decision.ts's VaultDecision.
// vaultId, strategyVersion, modelId, and proposedAt are trusted context this
// codebase supplies itself, never something the model asserts about its own
// identity or context, the same discipline MandateVault.sol applies by
// building VaultState from its own ledger rather than trusting a
// keeper-supplied one. Only the fields the AI agent actually decides go here.
export const LLMDecisionOutputSchema = z.object({
  action: DecisionActionSchema,
  asset: z.string().nullable(),
  amount: z.string().nullable(),
  targetAllocations: z.array(TargetAllocationSchema).nullable(),
  // For LP_OPEN/LP_INCREASE/LP_DECREASE/LP_COLLECT/LP_CLOSE only, null
  // otherwise, same nullable convention as every field above, mirroring
  // shared/decision.ts's VaultDecision fields exactly (see that file's
  // own doc comment for what each means).
  lpPool: z.string().nullable(),
  lpFeeTier: z.number().int().nullable(),
  tickLower: z.number().int().nullable(),
  tickUpper: z.number().int().nullable(),
  amount0Desired: z.string().nullable(),
  amount1Desired: z.string().nullable(),
  lpTokenId: z.string().nullable(),
  liquidityFractionBps: z.number().int().min(0).max(10000).nullable(),
  // For BRIDGE_DEPOSIT/BRIDGE_WITHDRAW only, null otherwise, see
  // shared/decision.ts's VaultDecision for what each means.
  bridgeChainId: z.number().int().nullable(),
  bridgeAmount: z.string().nullable(),
  bridgePositionId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export type LLMDecisionOutput = z.infer<typeof LLMDecisionOutputSchema>;
