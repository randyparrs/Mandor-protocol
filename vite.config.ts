import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Privy needs no Node-builtin polyfills or custom env plumbing, unlike
// Circle Wallets (see experiments/circle-wallets/README.md for what that
// required and why it was reverted). VITE_PRIVY_APP_ID is picked up by
// Vite's default VITE_-prefixed import.meta.env exposure automatically.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // server/timelineApi.ts, a read-only wrapper around
      // buildDecisionTimeline (server/indexer/eventIndexer.ts) and, since
      // the Paper Vault timeline was added, also
      // data/paperVaultDecisions.jsonl. No secrets, unlike the shelved
      // Circle proxy this same proxy pattern used to point at. Proxies the
      // whole /api prefix (not just /api/timeline) so every current and
      // future route this same backend adds is forwarded, rather than
      // needing a new proxy entry per route: a mismatch here silently
      // falls through to Vite's own index.html SPA fallback instead of a
      // clear connection error, exactly the failure mode that slipped
      // through when only /api/timeline was listed.
      "/api": "http://localhost:8789",
    },
  },
});
