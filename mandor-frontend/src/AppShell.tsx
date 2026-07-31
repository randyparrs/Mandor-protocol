import React from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LimitationPopover from './components/LimitationPopover';
import VaultsPage from './pages/VaultsPage';
import PortfolioPage from './pages/PortfolioPage';
import WalletPage from './pages/WalletPage';
import TimelinePage from './pages/TimelinePage';
import PaperVaultPage from './pages/PaperVaultPage';
import AnalyticsPage from './pages/AnalyticsPage';
import HowItWorksPage from './pages/HowItWorksPage';
import SettingsPage from './pages/SettingsPage';
import PlaceholderPage from './pages/PlaceholderPage';
import type { ShellVals } from './types';

/** Presentational shell: receives every value it renders through `v`. */
export default function AppShell({ v }: { v: ShellVals }) {
  return (
    <>
      <div data-screen-label="App Shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0D0E12', color: '#FFFFFF', fontFamily: '\'Inter\', system-ui, sans-serif' }}>
        <Sidebar v={v} />
        <div style={{ flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
          <Header v={v} />
          {v.showVaults && <VaultsPage v={v} />}
          {v.showPortfolio && <PortfolioPage v={v} />}
          {v.showWallet && <WalletPage v={v} />}
          {v.showTimeline && <TimelinePage v={v} />}
          {v.showPaper && <PaperVaultPage v={v} />}
          {v.showAnalytics && <AnalyticsPage v={v} />}
          {v.showHow && <HowItWorksPage v={v} />}
          {v.showSettings && <SettingsPage v={v} />}
          {v.showPlaceholder && <PlaceholderPage v={v} />}
        </div>
      </div>
      {v.limitOpen && <LimitationPopover v={v} />}
    </>
  );
}
