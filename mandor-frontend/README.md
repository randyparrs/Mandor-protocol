# Mandor Protocol -- frontend

React + TypeScript + Vite port of the Mandor App Shell v3 design. The visual
design, spacing, typography and component hierarchy are carried over verbatim:
every value is an inline style object, exactly as in the source design -- no CSS
framework, no utility classes, no design-token indirection.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
```

Fonts (Inter, JetBrains Mono) are loaded from Google Fonts in `index.html`.

## Architecture

```
src/
  main.tsx              mount point
  ShellController.tsx   ALL state + behaviour; produces the view-model (renderVals)
  AppShell.tsx          layout frame: Sidebar + Header + active page
  types.ts              ShellVals (the view-model) and ShellProps
  components/
    Sidebar.tsx         navigation, network badge, social links
    Header.tsx          page title/description, connect / wallet chip
    Hoverable.tsx       inline-style element with :hover / :active / :focus states
    LimitationPopover.tsx  anchored "Known limitation" dialog for vault cards
  pages/
    VaultsPage.tsx      four vault cards (v3, v5, v6, v7) with deposit/withdraw forms
    PortfolioPage.tsx   aggregated position, allocation, per-vault breakdowns, history
    WalletPage.tsx      embedded wallet: balance hero, send/receive, assets, activity
    TimelinePage.tsx    agent decision log with per-vault filters
    PaperVaultPage.tsx  simulated v5 rebalancing demo
    AnalyticsPage.tsx   protocol metrics, TVL over time, fee and allocation charts
    HowItWorksPage.tsx  decision flow, architecture, safeguards
    SettingsPage.tsx    account, preferences, network
    PlaceholderPage.tsx empty-state fallback
  shared/money.js       currency formatting (loaded lazily by the controller)
  styles/global.css     resets, scrollbars, keyframes only -- everything else is inline
```

### Data flow

`ShellController` owns state (active page, wallet connection, per-vault form
state, transaction outcomes, settings) and derives a flat view-model --
`ShellVals` -- of primitives, arrays and handlers. Every component below it is
**purely presentational**: it takes `v: ShellVals` and renders. Nothing below
the controller holds state except `Hoverable`, which tracks its own pointer
and focus state so inline styles can express interaction.

To wire this to a real backend, replace the seeded values and the vault fetch in
`ShellController` (`componentDidMount` / `fetchVault`) -- the render tree does
not need to change.

### Configurable inputs

`ShellProps` (see `types.ts`) exposes the design-time switches -- wallet
address display, scenario (`today` / `live demo`), vault data state and
transaction outcome -- as optional props on `<ShellController />`, with
`defaultShellProps` as the defaults. Useful for demos, stories and tests:

```tsx
<ShellController scenario="live demo" txOutcome="failed" />
```

### Interaction states

The design specifies hover styles inline. `Hoverable` renders any element
(`as="div" | "button" | "a" | …`) and merges `hover`, `focus` and `active`
style objects over the base style, so no stylesheet is needed for state.

### Notes

- `tsconfig.json` runs `strict` with `noImplicitAny: false`; the controller's
  ported handlers are untyped by design so the port stayed 1:1. Tightening them
  is safe, incremental work.
- Icons are inline SVG -- no icon dependency.
- `preview-no-build.html` (project root, outside this folder) renders the app
  straight from source with in-browser Babel, for a look without installing.
