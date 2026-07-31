import React from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import './styles/global.css';
import ShellController from './ShellController';
import { ARC_TESTNET } from './lib/arcChain';

// Same provider, same config shape already proven in src/main.tsx (the old
// frontend's real, live-verified Privy wiring), reused rather than
// reinvented.
const privyAppId = import.meta.env.VITE_PRIVY_APP_ID as string;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['google', 'email', 'wallet'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: ARC_TESTNET,
        supportedChains: [ARC_TESTNET],
      }}
    >
      <ShellController />
    </PrivyProvider>
  </React.StrictMode>
);
