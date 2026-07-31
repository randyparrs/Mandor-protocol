// Shared money-formatting utility — single source of truth for currency display.
export function formatMoney(value, { symbol = '$', decimals = 2 } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const parts = Number(value).toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return symbol + parts.join('.');
}

export function formatUSDC(value) {
  return formatMoney(value, { symbol: '', decimals: 2 }) + ' USDC';
}
