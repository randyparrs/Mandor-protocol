// This project's installed @types/node is older than the actual Node
// runtime it runs on (v24.14.1, confirmed via `node --version`) and does
// not yet type node:sqlite's real `readOnly` constructor option, even
// though the runtime genuinely supports it (confirmed against Node's own
// official docs before using it in server/db/decisionStore.ts and
// server/db/eventStore.ts). Declaration merging adds the real option to
// the existing ambient module instead of casting to `any` at every call
// site, keeping the rest of DatabaseSyncOptions's real type checking
// intact.
declare module "node:sqlite" {
  interface DatabaseSyncOptions {
    readOnly?: boolean | undefined;
  }
}
