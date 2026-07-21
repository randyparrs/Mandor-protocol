import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildSystemBlocks, wrapUntrustedMarketData } from "./systemPrompt.js";
import { getModelPin } from "./modelPin.js";
import { LLMDecisionOutputSchema } from "./schemas.js";
import type { LLMDecisionOutput, MarketData, VaultDecision, VaultState } from "./types.js";

export interface ProposeDecisionInput {
  vaultId: `0x${string}`;
  strategyVersion: string;
  strategyConfigText: string;
  policyLimitsText: string;
  vaultState: VaultState;
  marketData: MarketData;
}

export interface ProposeDecisionResult {
  decision: VaultDecision;
  // Hash of the exact rendered system prompt (after vault-specific
  // variables are substituted), stored alongside modelId so a prompt edit
  // that skipped Paper Vault re-validation is as auditable as a model
  // change, see docs/architecture.md.
  promptHash: string;
  // Same authority status as decision.reasoning: explainability and audit
  // value only, zero execution authority. null when the model didn't think
  // for this request (adaptive thinking can decide not to). Raw text here,
  // not pre-hashed, agent/core's job is to surface it; whether a future
  // DecisionRecord stores it raw or hashed is that layer's call, not this
  // module's.
  thinkingText: string | null;
  // Actual thinking tokens spent on this call, straight from the API's own
  // usage accounting, not estimated. Compare across action types once real
  // usage data exists, to confirm empirically that HOLD costs less than
  // ENTER/EXIT/EMERGENCY_EXIT_TO_STABLE rather than assuming it.
  thinkingTokens: number | null;
  rawOutput: LLMDecisionOutput;
}

function buildUserContent(vaultState: VaultState, marketData: MarketData): string {
  const parts = [
    `<vault_state>\n${JSON.stringify(vaultState, null, 2)}\n</vault_state>`,
    `<market_prices>\n${JSON.stringify(marketData.prices, null, 2)}\n</market_prices>`,
  ];
  if (marketData.untrustedContext) {
    parts.push(wrapUntrustedMarketData(marketData.untrustedContext));
  }
  return parts.join("\n\n");
}

function hashSystemBlocks(blocks: Array<{ text: string }>): string {
  const hash = createHash("sha256");
  for (const block of blocks) hash.update(block.text);
  return hash.digest("hex");
}

/// @notice proposeDecision only ever reads vault state and market data and
/// asks the AI agent to produce a structured decision, per agent/core/README.md.
/// It never signs, never builds a transaction, and never trusts the model
/// for anything about its own context (vaultId, strategyVersion, modelId
/// come from trusted input/the pin registry, never from the model's own
/// output). Extended thinking is adaptive rather than gated by action type:
/// the action is exactly what this call is deciding, so branching thinking
/// on the action before it exists is not possible, adaptive thinking already
/// self-moderates depth per request, a HOLD naturally costs less than an
/// EMERGENCY_EXIT_TO_STABLE without any explicit branch here.
export async function proposeDecision(input: ProposeDecisionInput): Promise<ProposeDecisionResult> {
  const pin = getModelPin(input.vaultId);
  const client = new Anthropic();

  const systemBlocks = buildSystemBlocks({
    strategyConfigText: input.strategyConfigText,
    policyLimitsText: input.policyLimitsText,
  });
  const promptHash = hashSystemBlocks(systemBlocks);
  const userContent = buildUserContent(input.vaultState, input.marketData);

  const message = await (async () => {
    try {
      return await client.messages.parse({
        model: pin.modelId,
        max_tokens: 8000,
        // display: "summarized" is the documented default for adaptive
        // thinking, set explicitly anyway so this never silently depends on
        // a default that could change, we need the actual text back to
        // audit it.
        thinking: { type: "adaptive", display: "summarized" },
        system: systemBlocks,
        messages: [{ role: "user", content: userContent }],
        output_config: {
          effort: "high",
          format: zodOutputFormat(LLMDecisionOutputSchema),
        },
      });
    } catch (error) {
      // Verified against the installed SDK's own source
      // (node_modules/@anthropic-ai/sdk/src/lib/parser.ts): if max_tokens
      // cuts the response off before the structured JSON completes,
      // JSON.parse throws inside zodOutputFormat's parse callback; if it
      // lands on syntactically valid but schema-incomplete JSON,
      // zodObject.safeParse fails instead. Either way client.messages.parse
      // rejects here, there is no path where a truncated or partially-valid
      // decision is silently accepted. This propagates exactly like any
      // other failed proposal: discarded, never auto-retried by this
      // function.
      throw new Error(
        `proposeDecision failed to obtain a complete, valid structured decision (possibly truncated by the max_tokens limit): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  })();

  if (message.stop_reason === "refusal") {
    throw new Error("The AI agent declined to propose a decision (safety refusal)");
  }

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error("The AI agent did not return a parsed structured output");
  }

  const thinkingBlocks = message.content.filter((block): block is Anthropic.Messages.ThinkingBlock => block.type === "thinking");
  const thinkingText = thinkingBlocks.length > 0 ? thinkingBlocks.map((block) => block.thinking).join("\n\n") : null;
  const thinkingTokens = message.usage.output_tokens_details?.thinking_tokens ?? null;

  const decision: VaultDecision = {
    vaultId: input.vaultId,
    strategyVersion: input.strategyVersion,
    modelId: pin.modelId,
    action: parsed.action,
    asset: parsed.asset ?? undefined,
    amount: parsed.amount ?? undefined,
    targetAllocations: parsed.targetAllocations ?? undefined,
    lpPool: (parsed.lpPool as `0x${string}` | null) ?? undefined,
    lpFeeTier: parsed.lpFeeTier ?? undefined,
    tickLower: parsed.tickLower ?? undefined,
    tickUpper: parsed.tickUpper ?? undefined,
    amount0Desired: parsed.amount0Desired ?? undefined,
    amount1Desired: parsed.amount1Desired ?? undefined,
    lpTokenId: parsed.lpTokenId ?? undefined,
    liquidityFractionBps: parsed.liquidityFractionBps ?? undefined,
    bridgeChainId: parsed.bridgeChainId ?? undefined,
    bridgeAmount: parsed.bridgeAmount ?? undefined,
    bridgePositionId: parsed.bridgePositionId ?? undefined,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    proposedAt: new Date().toISOString(),
  };

  return { decision, promptHash, thinkingText, thinkingTokens, rawOutput: parsed };
}
