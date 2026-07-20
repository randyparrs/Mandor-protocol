import type { PaperVaultTimelineEntry } from "../lib/paperVaultTimeline";

// Deliberately far from DecisionTimeline.tsx's real, onchain-verified
// card styling (plain white cards, solid border): a striped, high-contrast
// treatment repeated at both the section level and on every single card,
// so a viewer never mistakes this for real vault activity, whether they
// see the whole section or just one card cropped out of it. Per Randy's
// explicit ask: a hackathon judge must never be able to look at this and
// think the simulated cirBTC exposure here was ever a real trade.
const STRIPE_BACKGROUND = "repeating-linear-gradient(135deg, #fff3cd, #fff3cd 12px, #ffe69c 12px, #ffe69c 24px)";

function SimulatedBadge() {
  return (
    <span
      style={{
        background: "#000",
        color: "#ffd43b",
        padding: "3px 10px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: "bold",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      Simulated · no real funds
    </span>
  );
}

function PaperDecisionCard({ item }: { item: PaperVaultTimelineEntry }) {
  const { decision } = item;
  return (
    <div style={{ border: "2px dashed #b8860b", borderRadius: 6, padding: "1rem", marginBottom: "1rem", background: "#fffdf5" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong>{decision.action}</strong>
        <SimulatedBadge />
      </div>
      <div style={{ fontSize: 12, color: "#666" }}>
        proposed {new Date(decision.proposedAt).toLocaleString()} · confidence {(decision.confidence * 100).toFixed(0)}% · model {decision.modelId}
      </div>

      {(decision.asset || decision.amount) && (
        <div style={{ fontSize: 13, marginTop: 4 }}>
          {decision.asset && <>asset: {decision.asset} </>}
          {decision.amount && <>amount: {decision.amount}</>}
        </div>
      )}
      {decision.targetAllocations && decision.targetAllocations.length > 0 && (
        <ul style={{ fontSize: 13, margin: "4px 0" }}>
          {decision.targetAllocations.map((t) => (
            <li key={t.asset}>
              {t.asset}: {(t.targetWeightBps / 100).toFixed(2)}%
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 8 }}>
        <strong>Reasoning:</strong>
        <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{decision.reasoning}</p>
      </div>

      <details style={{ marginTop: 4 }}>
        <summary>Thinking trace{typeof item.thinkingTokens === "number" ? ` (${item.thinkingTokens} tokens)` : ""}</summary>
        <p style={{ margin: "4px 0", whiteSpace: "pre-wrap", color: item.thinkingText ? "inherit" : "#999" }}>
          {item.thinkingText ? item.thinkingText : "No thinking trace available for this decision."}
        </p>
      </details>

      <div style={{ marginTop: 8 }}>
        <strong>Offchain pre-check (advisory, never authoritative):</strong>{" "}
        {item.policyCheck.passed ? (
          <span>passed</span>
        ) : (
          <span style={{ color: "#a10000" }}>failed: {item.policyCheck.violations.map((v) => v.code).join(", ")}</span>
        )}
      </div>

      <div style={{ marginTop: 8, fontWeight: "bold", color: "#8a5c00" }}>
        Never executed onchain. This decision was simulated only, no real funds were ever at risk.
      </div>
    </div>
  );
}

/// @notice Renders scripts/paperVaultCycle.ts's simulated decision history
/// (data/paperVaultDecisions.jsonl). Deliberately, aggressively distinct
/// from DecisionTimeline (real, onchain-verified v1/v2 history): a thick
/// striped section border, a black-and-yellow "SIMULATED" banner at the
/// top, and a repeated black-and-yellow badge plus an explicit "never
/// executed onchain" line on every single card, not just a section-level
/// note that could scroll out of view or get cropped out of a screenshot.
export function PaperVaultTimeline({ entries }: { entries: PaperVaultTimelineEntry[] }) {
  return (
    <div style={{ border: "4px solid #b8860b", borderRadius: 8, padding: "1rem", background: STRIPE_BACKGROUND }}>
      <div
        style={{
          background: "#000",
          color: "#ffd43b",
          padding: "12px 14px",
          borderRadius: 6,
          fontWeight: "bold",
          fontSize: 15,
          textAlign: "center",
          marginBottom: "1rem",
          letterSpacing: 0.5,
        }}
      >
        SIMULATED · PAPER VAULT · NO REAL FUNDS ARE EVER MOVED HERE
      </div>
      {entries.length === 0 ? <p>No simulated decisions recorded yet.</p> : entries.map((item, i) => <PaperDecisionCard key={`${item.decision.proposedAt}-${i}`} item={item} />)}
    </div>
  );
}
