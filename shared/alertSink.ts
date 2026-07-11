// The "same monitoring/alerting channel" docs/architecture.md and
// docs/threat-model.md refer to for both the keeper (executor/) and the
// indexer (server/indexer/), moved here (was executor/alertSink.ts) once
// server/indexer/ needed the same interface, matching the same
// used-by-more-than-one-module reasoning shared/money.ts was created for.
// Minimal and generic on purpose: no notification channel (Slack/PagerDuty/
// webhook) exists anywhere in this repo yet. ConsoleAlertSink is the real
// Phase 1 implementation, not a placeholder, same "build the minimal real
// thing now, a richer integration is additive later" pattern already used
// elsewhere in this project (the autopause bounty bot, Forta deferred to
// Phase 5). Swapping in a real webhook sink later means implementing
// AlertSink, not redesigning any of its callers.
export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertEvent {
  severity: AlertSeverity;
  code: string;
  detail: string;
  at: string;
}

export interface AlertSink {
  send(event: AlertEvent): void;
}

export class ConsoleAlertSink implements AlertSink {
  send(event: AlertEvent): void {
    const line = `[${event.severity}] ${event.code}: ${event.detail}`;
    if (event.severity === "critical") {
      console.error(line);
    } else if (event.severity === "warning") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export function makeEvent(severity: AlertSeverity, code: string, detail: string): AlertEvent {
  return { severity, code, detail, at: new Date().toISOString() };
}
