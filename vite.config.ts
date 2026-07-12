import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Privy needs no Node-builtin polyfills or custom env plumbing, unlike
// Circle Wallets (see experiments/circle-wallets/README.md for what that
// required and why it was reverted). VITE_PRIVY_APP_ID is picked up by
// Vite's default VITE_-prefixed import.meta.env exposure automatically.
export default defineConfig({
  plugins: [react()],
});
