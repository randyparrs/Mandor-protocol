import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import App from "./App";
import { ARC_TESTNET } from "./lib/arcChain";

// Same provider, same config shape as Vpay's proven main.tsx
// (design_handoff_vpay/app/src/main.tsx), the pattern Randy asked to
// reuse rather than reinvent. VITE_PRIVY_APP_ID is a plain VITE_-prefixed
// var, picked up by Vite's default import.meta.env exposure, no custom
// vite.config.ts define needed (unlike Circle's setup, see
// experiments/circle-wallets/README.md).
const privyAppId = import.meta.env.VITE_PRIVY_APP_ID as string;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["google", "email", "wallet"],
        // Nested under `ethereum`, not flat, in the installed
        // @privy-io/react-auth@^3.34.0 (Vpay's proven config used ^3.32.2,
        // a flat `embeddedWallets: { createOnLogin }`, confirmed via
        // tsc that the shape changed between those versions, not guessed).
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: ARC_TESTNET,
        supportedChains: [ARC_TESTNET],
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
);
