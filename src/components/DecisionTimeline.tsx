import type { DecisionTimelineEntry, TimelineIndexedEvent } from "../lib/timeline";

const ARC_EXPLORER_TX_BASE = "https://testnet.arcscan.app/tx/";

const VAULT_EVENT_COLORS: Record<string, string> = {
  Paused: "#f8d7da",
  AutoPaused: "#f8d7da",
  AutoPauseBountyCallFailed: "#fff3cd",
  Unpaused: "#d1e7dd",
};

/// @notice Pause/unpause/auto-pause history for this vault's policy
/// contract, shown separately from the per-decision timeline below: real
/// transparency for a depositor deciding whether to trust a vault, not
/// something withheld as sensitive (PAUSER_ROLE/GOVERNANCE_ROLE/
/// ADMIN_ROLE addresses are public onchain roles, already listed in
/// docs/deployments.md, see src/lib/timeline.ts's own doc comment).
export function VaultLevelEvents({ events }: { events: TimelineIndexedEvent[] }) {
  if (events.length === 0) {
    return <p style={{ color: "#666" }}>No pause/auto-pause events recorded for this vault.</p>;
  }
  return (
    <ul style={{ listStyle: "none", padding: 0 }}>
      {events.map((event) => (
        <li
          key={event.transactionHash + event.blockNumber}
          style={{ background: VAULT_EVENT_COLORS[event.eventName] ?? "#e2e3e5", padding: "6px 10px", borderRadius: 4, marginBottom: 6 }}
        >
          <strong>{event.eventName}</strong> at block {event.blockNumber} (
          <a href={`${ARC_EXPLORER_TX_BASE}${event.transactionHash}`} target="_blank" rel="noreferrer">
            tx
          </a>
          )
        </li>
      ))}
    </ul>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending_confirmation: "#fff3cd",
  confirmed: "#cfe2ff",
  executed: "#d1e7dd",
  rejected: "#e2e3e5",
  expired: "#e2e3e5",
  policy_rejected: "#f8d7da",
};

function StatusBadge({ status }: { status: string }) {
  const background = STATUS_COLORS[status] ?? "#e2e3e5";
  return <span style={{ background, padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: "bold" }}>{status}</span>;
}

/// @notice One card per decision: reasoning + thinking (explainability
/// only, zero execution authority, see shared/decision.ts and
/// server/decisionPipeline.ts's own doc comments on both fields) +
/// offchain pre-check result + ops confirmation/rejection + the real
/// onchain outcome, all in one place, matching
/// docs/architecture.md's "AI Decision Timeline".
function DecisionCard({ item }: { item: DecisionTimelineEntry }) {
  const { entry } = item;
  const { decision } = entry.queued;

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: "1rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{decision.action}</strong>
        <StatusBadge status={entry.queued.status} />
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
        <summary>Thinking trace{typeof entry.thinkingTokens === "number" ? ` (${entry.thinkingTokens} tokens)` : ""}</summary>
        <p style={{ margin: "4px 0", whiteSpace: "pre-wrap", color: entry.thinkingText ? "inherit" : "#999" }}>
          {entry.thinkingText ? entry.thinkingText : "No thinking trace available for this decision."}
        </p>
      </details>

      <div style={{ marginTop: 8 }}>
        <strong>Offchain pre-check (advisory, never authoritative):</strong>{" "}
        {entry.policyCheck.passed ? (
          <span>passed</span>
        ) : (
          <span style={{ color: "#a10000" }}>failed: {entry.policyCheck.violations.map((v) => v.code).join(", ")}</span>
        )}
      </div>

      {entry.anomalyFlags.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <strong>Anomaly flags:</strong>
          <ul style={{ margin: "4px 0" }}>
            {entry.anomalyFlags.map((f, i) => (
              <li key={i}>
                {f.code}: {f.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <strong>Ops:</strong>{" "}
        {entry.queued.confirmedBy ? (
          <span>
            confirmed by {entry.queued.confirmedBy} at {new Date(entry.queued.confirmedAt!).toLocaleString()}
          </span>
        ) : entry.resolvedBy ? (
          <span>rejected by {entry.resolvedBy}</span>
        ) : (
          <span>awaiting confirmation (expires {new Date(entry.queued.expiresAt).toLocaleString()})</span>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <strong>Onchain result:</strong>{" "}
        {entry.txHash ? (
          <a href={`${ARC_EXPLORER_TX_BASE}${entry.txHash}`} target="_blank" rel="noreferrer">
            {entry.txHash}
          </a>
        ) : (
          <span>not executed onchain</span>
        )}
        {item.onchainEvent && (
          <div style={{ fontSize: 12, color: "#666" }}>
            {item.onchainEvent.eventName} at block {item.onchainEvent.blockNumber}
          </div>
        )}
      </div>
    </div>
  );
}

export function DecisionTimeline({ entries }: { entries: DecisionTimelineEntry[] }) {
  if (entries.length === 0) {
    return <p>No decisions recorded yet for this vault.</p>;
  }
  return (
    <div>
      {entries.map((item) => (
        <DecisionCard key={item.entry.decisionId} item={item} />
      ))}
    </div>
  );
}
