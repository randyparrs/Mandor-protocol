// The "same monitoring/alerting channel" docs/architecture.md's keeper
// section refers to, minimal and generic on purpose: no notification
// channel (Slack/PagerDuty/webhook) exists anywhere in this repo yet
// (confirmed, only doc mentions). ConsoleAlertSink is the real Phase 1
// implementation, not a placeholder, same "build the minimal real thing
// now, a richer integration is additive later" pattern already used
// elsewhere in this project (the autopause bounty bot, Forta deferred to
// Phase 5). Swapping in a real webhook sink later means implementing
// AlertSink, not redesigning keeperService.ts.
export type AlertSeverity = "info" | "warning" | "critical";

export interface KeeperEvent {
  severity: AlertSeverity;
  code: string;
  detail: string;
  at: string;
}

export interface AlertSink {
  send(event: KeeperEvent): void;
}

export class ConsoleAlertSink implements AlertSink {
  send(event: KeeperEvent): void {
    const line = `[keeper:${event.severity}] ${event.code}: ${event.detail}`;
    if (event.severity === "critical") {
      console.error(line);
    } else if (event.severity === "warning") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export function makeEvent(severity: AlertSeverity, code: string, detail: string): KeeperEvent {
  return { severity, code, detail, at: new Date().toISOString() };
}
