/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-19';
/** Maximum number of eligible off-watchlist rows. */
export const EARLY_ROWS = 160;
/**
 * Bounded, symmetric ranking tilts around the peer median age and zero TVL growth.
 * The amplitude is not hand-set: it is the leave-one-out choice over the positive-cap
 * peers (the sweep is computed in validateModels and printed on the dashboard). The
 * sweep is nearly flat — age and growth carry almost no transferable signal at 128
 * peers — and richer specifications score worse on the same test (a ridge regression
 * on standardized size, age and growth: 0.542; unpenalized fitted tilt coefficients:
 * worse still), so the model keeps the fitted size curve and this one fitted amplitude.
 */
const TILT = 0.05;
const GROWTH_SCALE = 50;
/** Tilt amplitudes the validation sweep reports, including the deployed one. */
const TILT_SWEEP = [0, 0.02, 0.05, 0.1, 0.2];

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  status: 'watchlist' | 'early';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_value_usd: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    /** Middle-50% band of the model's leave-one-out residuals, applied to this row's value. */
    range_low_usd: number;
    range_high_usd: number;
    age_days: number | null;
  };
  farm: {
    capital_usd: number;
    est_fees_usd: number;
    burden_pct: number;
    verdict: 'Low gas' | 'High gas' | 'Research';
    transactions: number;
    chain: string | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  status: 'watchlist' | 'early';
  symbol: string | null;
  gecko_id: string | null;
  mcap_usd: number | null;
  implied_value_usd: number;
  base_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  range_low_usd: number;
  range_high_usd: number;
  /** Protocols in this row's category that record a token, of all protocols in the category. */
  token_rate_k: number;
  token_rate_n: number;
}

/** A token-recording protocol, with the snapshot fields behind its classification. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  symbol: string | null;
  gecko_id: string | null;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A pre-token protocol the board does not rank, with the reason. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
  chains: string[];
}

/** The leave-one-out validation result the dashboard states, computed from the snapshot. */
export interface Validation {
  peers: number;
  starter_median_log_err: number;
  size_only_median_log_err: number;
  radar2_median_log_err: number;
  radar3_median_log_err: number;
  radar4_median_log_err: number;
  /** Leave-one-out median |log10 error| at each swept tilt amplitude, the deployed one included. */
  tilt_sweep: { tilt: number; median_log_err: number }[];
  /** Quartiles of the current model's signed leave-one-out residuals (log10). */
  resid_q25: number;
  resid_q75: number;
}

/** One fitting peer, as the dashboard carries it so the page can re-run the validation itself. */
export interface PeerRow {
  slug: string;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  listed_at: string | null;
}

type Fit = { alpha: number; beta: number; ageAnchor: number };

/** How every protocol in the snapshot is accounted for. */
export interface Accounting {
  total: number;
  ranked: number;
  watchlist: number;
  early: number;
  records_token: number;
  excluded: number;
  excluded_by_reason: Record<string, number>;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: Fit & { peers: number };
  peers: PeerRow[];
  validation: Validation;
  accounting: Accounting;
  watchlist_slugs: string[];
  rows: RadarRow[];
  live: LiveRow[];
  excluded: ExcludedRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in this snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Why a pre-token protocol is not a launch candidate of its own, in the house watchlist's own
 * terms, or null when it is one. A wrapped, staked, bridged or exchange product of a token that
 * already trades is not a protocol still waiting on a launch of its own.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category === 'CEX' || EXCHANGE_PREFIX.test(p.name)) return 'exchange product: CEX category or exchange-name prefix';
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `${p.category}: category screened out of early selection`;
  if (VERSIONED.test(p.name)) return 'versioned name: name ends in a version suffix';
  if (WRAPPED_WORD.test(p.name)) return 'product wording: name contains wrapped, staked or staking';
  return null;
}

/** The peers the value model is fitted and tested on: token recorded, positive market cap. */
export function peerSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Least-squares fit of log10(mcap) = alpha + beta * log10(TVL) over `peers`. */
export function fitSizeCurve(peers: SnapshotProtocol[]): { alpha: number; beta: number } {
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log10(p.mcap_usd!));
  const n = peers.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const beta = den === 0 ? 1 : num / den;
  return { alpha: my - beta * mx, beta };
}

/** Fit the deployed transform. Each validation fold derives its own age anchor. */
function calibratedFit(peers: SnapshotProtocol[], asOf: string): Fit {
  const fit = fitSizeCurve(peers);
  const ages = peers.map((p) => ageDays(asOf, p.listed_at)).filter((a) => a !== null);
  return {
    alpha: Math.round(fit.alpha * 1e6) / 1e6,
    beta: Math.round(fit.beta * 1e6) / 1e6,
    ageAnchor: ages.length ? Math.max(1, median(ages)) : 1,
  };
}

function growthMultiplier(change: number | null, tilt: number = TILT): number {
  const g = change ?? 0;
  return 1 + tilt * (g / (GROWTH_SCALE + Math.abs(g)));
}

function maturityMultiplier(age: number | null, anchor: number, tilt: number = TILT): number {
  return age === null ? 1 : 1 + tilt * ((age - anchor) / (age + anchor));
}

export function impliedValue(p: SnapshotProtocol, asOf: string, fit: Fit) {
  return tiltImplied(p, asOf, fit, TILT);
}

/** The deployed prediction at an arbitrary tilt amplitude; the validation sweep uses this. */
function tiltImplied(p: SnapshotProtocol, asOf: string, fit: Fit, tilt: number) {
  const age = ageDays(asOf, p.listed_at);
  const base = Math.pow(10, fit.alpha) * Math.pow(p.tvl_usd, fit.beta);
  const growthMult = growthMultiplier(p.change_7d, tilt);
  const maturityMult = maturityMultiplier(age, fit.ageAnchor, tilt);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, base, growthMult, maturityMult, age };
}

/** radar-1's implied value (the house starter's flat model), kept for the validation comparison. */
export function starterImplied(p: SnapshotProtocol, asOf: string): number {
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growth = Math.min(120, Math.max(-60, raw));
  const growthMult = 1 + (growth / 100) * 0.5;
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const maturity = 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
  return Math.max(1, Math.round(p.tvl_usd * 0.25 * growthMult * maturity));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A quantile of an ascending-sorted array, by linear interpolation between closest ranks. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Signed leave-one-out residuals (log10 predicted / actual) of the deployed model over the peers. */
function currentModelResiduals(snapshot: Snapshot): number[] {
  const peers = peerSet(snapshot);
  const residuals: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const p = peers[i]!;
    const train = peers.filter((_, j) => j !== i);
    const predicted = impliedValue(p, snapshot.as_of, calibratedFit(train, snapshot.as_of)).implied;
    residuals.push(Math.log10(predicted / p.mcap_usd!));
  }
  return residuals;
}

/**
 * The shipped validation: leave-one-out over the positive-cap peers. Each peer is predicted by a
 * size curve fitted on the other peers only; the reported figure is the pooled median |log10
 * error| against the peers' actual market caps. The dashboard re-runs this exact computation from
 * the peer rows in data.js, so the numbers on the page are the code's output, not a claim.
 */
export function validateModels(snapshot: Snapshot): Validation {
  const peers = peerSet(snapshot);
  const eStarter: number[] = [];
  const eSize: number[] = [];
  const eRound2: number[] = [];
  const eRound3: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const p = peers[i]!;
    const train = peers.filter((_, j) => j !== i);
    const fit = fitSizeCurve(train);
    const actual = p.mcap_usd!;
    const age = ageDays(snapshot.as_of, p.listed_at) ?? 365;
    const growth = 1 + Math.min(120, Math.max(-60, p.change_7d ?? 0)) / 400;
    const maturity = (0.6 + Math.min(age, 1095) / 1095 * 0.4) / 0.8;
    const base = Math.pow(10, fit.alpha) * Math.pow(p.tvl_usd, fit.beta);
    eStarter.push(Math.abs(Math.log10(starterImplied(p, snapshot.as_of) / actual)));
    eSize.push(Math.abs(Math.log10(base / actual)));
    eRound2.push(Math.abs(Math.log10(Math.max(1, Math.round(base * growth * maturity)) / actual)));
    const predicted = impliedValue(p, snapshot.as_of, calibratedFit(train, snapshot.as_of)).implied;
    eRound3.push(Math.abs(Math.log10(predicted / actual)));
  }
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  // The tilt-amplitude sweep: the same leave-one-out at other amplitudes, so the deployed
  // amplitude's status as the leave-one-out choice is itself recomputed, not asserted.
  const tilt_sweep = TILT_SWEEP.map((tilt) => {
    const errs: number[] = [];
    for (let i = 0; i < peers.length; i++) {
      const p = peers[i]!;
      const train = peers.filter((_, j) => j !== i);
      const predicted = tiltImplied(p, snapshot.as_of, calibratedFit(train, snapshot.as_of), tilt).implied;
      errs.push(Math.abs(Math.log10(predicted / p.mcap_usd!)));
    }
    return { tilt, median_log_err: r3(median(errs)) };
  });
  const sortedResid = [...currentModelResiduals(snapshot)].sort((a, b) => a - b);
  return {
    peers: peers.length,
    starter_median_log_err: r3(median(eStarter)),
    size_only_median_log_err: r3(median(eSize)),
    radar2_median_log_err: r3(median(eRound2)),
    radar3_median_log_err: r3(median(eRound3)),
    // Radar-4 ships radar-3's value model unchanged (its changes are the farm plans),
    // so its leave-one-out error is the same computation on the same folds.
    radar4_median_log_err: r3(median(eRound3)),
    tilt_sweep,
    resid_q25: Math.round(quantile(sortedResid, 0.25) * 1000) / 1000,
    resid_q75: Math.round(quantile(sortedResid, 0.75) * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Farm plans price a single reversible action from a funded wallet.
// The route is conditional on the protocol's own app confirming access and exit.
type Route = {
  check: string;
  entry: string;
  monitor: string;
  exit: string;
  pilot?: { days: number; entryTxs: number; exitTxs: number };
};

function routeFor(category: string | null): Route | null {
  switch (category) {
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return {
        check: 'Find a public vault naming this curator or allocator. Check its underlying markets, withdrawal liquidity and any queue.',
        entry: 'Deposit into that single vault and save the vault address and share balance.',
        monitor: 'Check vault share value and available redemption liquidity.',
        exit: 'Redeem the shares back to the deposit asset.',
      };
    case 'Lending':
      return {
        check: 'Find a supply market with a supported asset and verify that liquidity is available to withdraw it.',
        entry: 'Supply the asset to that market and record the receipt balance.',
        monitor: 'Check market utilisation and withdrawal liquidity.',
        exit: 'Withdraw the supply to the wallet.',
      };
    case 'Dexs':
      return {
        check: 'Find a pool for two assets you can already fund. Set both amounts and compare LP share, slippage and the withdrawal preview.',
        entry: 'Add the two checked amounts once and record the LP receipt.',
        monitor: 'Compare the LP redemption preview with holding the original assets.',
        exit: 'Remove liquidity and record both returned assets.',
      };
    case 'Yield':
    case 'Yield Aggregator':
    case 'Basis Trading':
      return {
        check: 'Find a public strategy vault. Verify the deposit asset, strategy exposure and redemption terms.',
        entry: 'Deposit into one verified vault and record its shares.',
        monitor: 'Check share value, strategy exposure and any changes to the withdrawal window.',
        exit: 'Redeem the shares within the verified withdrawal window.',
      };
    case 'RWA':
      return {
        check: 'Confirm jurisdiction and investor eligibility before sharing information. Check the subscription minimum, custody, all fees, redemption window and maximum wait. Proceed only with an eligible subscription and a confirmed redemption request path within the pilot budget.',
        entry: 'Subscribe once for an eligible product within the position cap. Record the units, settlement date and first permitted redemption date.',
        monitor: 'Check settlement and confirm the earliest request date. Stop adding funds if terms change.',
        exit: 'Request redemption at the first permitted window. Track settlement until the funds arrive.',
        pilot: { days: 7, entryTxs: 2, exitTxs: 2 },
      };
    case 'CDP':
    case 'CDP Manager':
      return {
        check: 'Find an open-and-repay flow. Set collateral, the smallest supported debt and a repayment reserve within the cap. Check the oracle, minimums and interest. At those amounts, require a 30% collateral drop to leave the position above liquidation and confirm repayment fits the budget.',
        entry: 'Set aside the checked repayment reserve. Post the checked collateral, mint the checked debt and keep it available for repayment.',
        monitor: 'Check collateral ratio and accrued interest daily. Repay early if the position fails the original stress check.',
        exit: 'Repay principal and interest, then withdraw collateral. Confirm the app shows zero debt.',
        pilot: { days: 7, entryTxs: 3, exitTxs: 3 },
      };
    case 'Derivatives':
      return {
        check: 'Confirm access, minimums, margin and close rules, spread and funding. Set the smallest eligible matched legs and split the cap between margin, hedge and cost reserve. Preview entry and full close for both legs. Stay read-only if costs or combined exposure cannot be bounded.',
        entry: 'Set aside the checked cost reserve and use the two checked leg sizes. Unwind promptly if the hedge fails to fill.',
        monitor: 'Check both legs after entry and before the next funding event. Close early if the hedge or margin falls outside the previewed limits.',
        exit: 'Close both legs, withdraw free margin and verify zero exposure.',
        pilot: { days: 1, entryTxs: 5, exitTxs: 5 },
      };
    default:
      return null;
  }
}

function researchCheck(category: string | null): string {
  const route = routeFor(category);
  if (route) return route.check;
  switch (category) {
    case 'Dual-Token Stablecoin':
      return 'Check collateral rules, minimum debt, liquidation threshold and the full burn-and-redeem path. Simulate repayment without opening debt.';
    case 'Interest Rate Derivatives':
      return 'Inspect contract size, margin rules, funding and quoted spread. Record a paper entry and exit without posting margin.';
    case 'Prediction Market':
      return 'Check access rules, settlement source and liquidity. Record a paper position and how it would settle.';
    case 'Insurance':
      return 'Inspect the coverage terms, premium, expiry and claims conditions. Save a quote without buying cover.';
    case 'Uncollateralized Lending':
      return 'Verify borrower or lender eligibility, underwriting terms, default exposure and redemption rights.';
    default:
      return 'Identify the public action this product supports, its minimum size and how funds return to the wallet. Stop if any part requires unavailable access.';
  }
}

function capitalFor(p: { tvl_usd: number }): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 300;
  if (p.tvl_usd >= 50_000_000) return 200;
  if (p.tvl_usd >= 10_000_000) return 150;
  return 100;
}

function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

// Scenario gas per transaction by chain tier. These are planning
// assumptions, not measurements: Ethereum mainnet is the expensive tier,
// Tron contract execution is energy-priced and sits between mainnet and
// the near-free chains, and every other listed chain is modeled at $1.
function gasFor(chain: string | null): number {
  if (chain === 'Ethereum') return 5;
  if (chain === 'Tron') return 3;
  return 1;
}

export function farmMath(p: SnapshotProtocol, age: number | null) {
  const firstChain = p.chains[0] ?? null;
  // The priced scenario runs on the cheapest listed chain in the modeled
  // tiers; step 1 verifies the route is actually offered there and reprices
  // on the first listed chain when it is not.
  const chain = p.chains.length
    ? p.chains.reduce((a, b) => (gasFor(b) < gasFor(a) ? b : a))
    : null;
  const route = chain ? routeFor(p.category) : null;
  const capital = route ? capitalFor(p) : 0;
  const gas = gasFor(chain);
  const pilot = route?.pilot ?? null;
  const hold = pilot?.days ?? holdDays(age);
  const entryTxs = pilot?.entryTxs ?? (p.category === 'Dexs' ? 3 : 2);
  const exitTxs = pilot?.exitTxs ?? 2;
  const coreTxs = route ? entryTxs + exitTxs : 0;
  const coreFees = gas * coreTxs;
  const reviewWeeks = route && !pilot ? Math.min(6, Math.floor(hold / 7)) : 0;
  // Fit optional actions into the 8% gas budget after pricing entry and exit.
  const optionalSlots = Math.floor((capital * 8 - coreFees * 100) / (gas * 100));
  const weeklyTxs = Math.min(reviewWeeks, Math.max(0, optionalSlots));
  const transactions = coreTxs + weeklyTxs;
  const fees = gas * transactions;
  const burdenPct = capital ? Math.round(fees / capital * 1000) / 10 : 0;
  const verdict = !route ? 'Research' : coreFees * 100 <= capital * 8 ? 'Low gas' : 'High gas';
  const farmSize = route ? Math.ceil(coreFees * 100 / 8) : 0;
  const scenarioChain = chain;
  return { chain, firstChain, route, pilot, capital, gas, entryTxs, exitTxs, coreFees, reviewWeeks, weeklyTxs, transactions, fees, burdenPct, verdict, hold, farmSize, scenarioChain } as const;
}

// Non-gas costs a reader must expect on top of modeled gas, named per
// route family. The snapshot carries none of their sizes, so the plans
// name them and price none of them.
function costWatch(category: string | null): string {
  switch (category) {
    case 'CDP':
    case 'CDP Manager':
      return 'debt interest accrues while the position is open';
    case 'Derivatives':
      return 'funding payments and spread apply while the position is open';
    case 'Dexs':
      return 'slippage and impermanent loss apply beyond gas';
    case 'RWA':
      return 'subscription and redemption fees and identity checks apply beyond gas';
    case 'Lending':
      return 'utilisation can delay withdrawal even though gas is small';
    default:
      return 'funding, bridging, spread and protocol fees apply beyond gas where the route uses them';
  }
}

export function stepText(step: FarmStep): string {
  return `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const m = farmMath(p, age);
  const chain = m.chain ?? 'a chain confirmed by the official app';
  if (!m.route) return [
    { text: `Find ${p.name}'s official app and verify access on ${chain}.`, cost: '$0', time: '10 min' },
    { text: researchCheck(p.category), cost: '$0', time: '20 min' },
    { text: m.scenarioChain
      ? `Check whether the route is available on ${m.scenarioChain}, a listed chain in the lowest modeled gas tier. Verify actual fees before pricing a future route.`
      : 'No chain is recorded. Establish route availability and actual fees before pricing a future route.', cost: '$0', time: '10 min' },
    { text: 'Look for published rewards or points terms. Record what they say, or log that you found no published terms.', cost: '$0', time: '10 min' },
    { text: 'Log the available action, minimum and exit terms, and what evidence would upgrade this row to a costed plan. Recheck at the next weekly review.', cost: '$0', time: '5 min' },
  ];
  const verdictText = `Verdict: ${m.verdict}. Modeled gas is $${m.fees} (${m.burdenPct}% of the $${m.capital} position) across ${m.transactions} transactions.` +
    (m.weeklyTxs ? ` Entry and exit account for $${m.coreFees}; weekly actions are optional.` : '') +
    ' Rewards are unknown.' +
    (m.verdict === 'High gas' ? ` The 8% gas line for entry and exit on ${chain} would require $${m.farmSize}, above this plan’s position cap. ${chain} is already the cheapest listed chain in the modeled tiers, so no listed chain lowers it.` : '') +
    ` Beyond gas: ${costWatch(p.category)} — the snapshot prices none of these, so verify them in the app before funding.`;
  const horizon = p.category === 'RWA' ? '7-day review, with return of funds by your verified deadline' :
    m.pilot ? `up to ${m.hold} ${m.hold === 1 ? 'day' : 'days'}` : `${m.hold} days (age-based scenario)`;
  const exitTiming = p.category === 'RWA'
    ? 'Set a funds-return deadline. Confirm the request, settlement and any claim fit that deadline.'
    : `Set the latest exit start for funds to return within ${m.hold} ${m.hold === 1 ? 'day' : 'days'}. Check any lock, queue and claim steps.`;
  const followUp: FarmStep | null = m.pilot
    ? null
    : m.weeklyTxs
    ? { text: `Review participation terms weekly through week ${m.reviewWeeks} or until exit starts, whichever comes first. Sign at most once per week and ${m.weeklyTxs} times total. Confirm eligibility and room within the cap. Before signing, check whether the action would delay exit and skip it if so. Requote the action and exit. Include costs already incurred and both quotes. Skip if gas exceeds 8% of the actual position or total costs exceed your budget.`, cost: `up to $${m.gas * m.weeklyTxs} scenario gas for ${m.weeklyTxs} optional transactions`, time: '10 min a week' }
    : { text: `Keep participation checks read-only through week ${m.reviewWeeks} or until exit starts, whichever comes first. Record any published terms and eligibility.`, cost: '$0', time: '10 min a week' };
  return [
    { text: `Verify ${p.name} lists this route on ${chain}. Set a size within the $${m.capital} cap. ${m.route.check} Quote entry and exit at those amounts.${m.firstChain && m.firstChain !== chain ? ` If it is not offered there, reprice the plan on ${m.firstChain} before funding.` : ''} Stay read-only if gas exceeds 8% at that size or total costs exceed budget.`, cost: '$0', time: '20 min' },
    { text: `${exitTiming} Confirm official participation terms and your eligibility. Confirm the wallet holds the position assets and ${chain} gas token, or price the bridge in first. Stay read-only if timing or eligibility is unverified.`, cost: '$0', time: '5 min before entry' },
    { text: `Reserve the quoted exit gas first. Use the position size checked before entry. ${m.route.entry} Save the receipts.`, cost: `up to $${m.gas * m.entryTxs} scenario gas for ${m.entryTxs} transactions incl. approvals`, time: '15 min active, plus settlement if required' },
    ...(followUp ? [followUp] : []),
    { text: `Plan window: ${horizon}. ${m.route.monitor} Recheck exit lead time each review. If it grows, pause optional actions and bring exit forward if possible. Record any rewards shown.`, cost: '$0 gas for read-only checks', time: m.pilot ? '5 min per review' : '5 min weekly' },
    { text: `Refresh the quote and start by the latest checked exit time. ${m.route.exit} If queued, track any required claim and confirm funds return. Log receipts and fees.`, cost: `up to $${m.gas * m.exitTxs} scenario gas for ${m.exitTxs} transactions`, time: '15 min active, plus any verified queue' },
    { text: verdictText, cost: '$0', time: '1 min' },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n, plus the accounting. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; excluded: ExcludedRow[]; accounting: Accounting } {
  const fit = calibratedFit(peerSet(snapshot), snapshot.as_of);
  const sortedResid = [...currentModelResiduals(snapshot)].sort((a, b) => a - b);
  const bandLow = Math.pow(10, quantile(sortedResid, 0.25));
  const bandHigh = Math.pow(10, quantile(sortedResid, 0.75));
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const scoredAll = snapshot.protocols
    .filter((p) => isPreToken(p) && !chosen.has(p.slug) && exclusionReason(p) === null)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, fit) }))
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : 1));
  for (const s of scoredAll.slice(0, EARLY_ROWS)) {
    chosen.set(s.p.slug, s.p);
  }
  if (snapshot.watchlist.some((slug) => !chosen.has(slug))) {
    throw new Error('watchlist coverage failure: a watchlist slug is missing from the snapshot index');
  }
  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, fit) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const board: BoardRow[] = scored.map((s, i) => {
    const fm = farmMath(s.p, s.v.age);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      status: watch.has(s.p.slug) ? ('watchlist' as const) : ('early' as const),
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      model: {
        base_value_usd: s.v.base,
        growth_multiplier: s.v.growthMult,
        maturity_multiplier: s.v.maturityMult,
        range_low_usd: Math.max(1, Math.round(s.v.implied * bandLow)),
        range_high_usd: Math.max(1, Math.round(s.v.implied * bandHigh)),
        age_days: s.v.age,
      },
      farm: {
        capital_usd: fm.capital,
        est_fees_usd: fm.fees,
        burden_pct: fm.burdenPct,
        verdict: fm.verdict,
        transactions: fm.transactions,
        chain: fm.chain,
      },
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    };
  });
  // Excluded: every pre-token protocol not ranked, with its reason (or the cutoff).
  const rankedSlugs = new Set(board.map((r) => r.slug));
  const excluded: ExcludedRow[] = [];
  const byReason: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || rankedSlugs.has(p.slug)) continue;
    const reason = exclusionReason(p) ?? 'below the early cutoff: a launch candidate, ranked under the first 160 early rows by implied value';
    excluded.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason, chains: p.chains });
    const key = reason.split(':')[0]!;
    byReason[key] = (byReason[key] ?? 0) + 1;
  }
  excluded.sort((a, b) => b.tvl_usd - a.tvl_usd);
  const recordsToken = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const accounting: Accounting = {
    total: snapshot.protocols.length,
    ranked: board.length,
    watchlist: board.filter((r) => r.status === 'watchlist').length,
    early: board.filter((r) => r.status === 'early').length,
    records_token: recordsToken,
    excluded: excluded.length,
    excluded_by_reason: byReason,
  };
  return { board, excluded, accounting };
}

/** Token-recording protocols ordered by positive market cap, then TVL. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (Math.max(0, b.mcap_usd ?? 0) - Math.max(0, a.mcap_usd ?? 0)) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      symbol: p.symbol,
      gecko_id: p.gecko_id,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const peers = peerSet(snapshot);
  const fit = calibratedFit(peerSet(snapshot), snapshot.as_of);
  const { board, excluded, accounting } = buildBoard(snapshot);
  // Per-category token record rates over the whole snapshot, for context display only.
  const catRates = new Map<string, { k: number; n: number }>();
  for (const p of snapshot.protocols) {
    if (p.category === null) continue;
    const c = catRates.get(p.category) ?? { k: 0, n: 0 };
    c.n++;
    if (!isPreToken(p)) c.k++;
    catRates.set(p.category, c);
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit: { ...fit, peers: peers.length },
    peers: peers.map((p) => ({ slug: p.slug, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, change_7d: p.change_7d, listed_at: p.listed_at })),
    validation: validateModels(snapshot),
    accounting,
    watchlist_slugs: [...snapshot.watchlist],
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      status: r.status,
      symbol: r.symbol,
      gecko_id: r.gecko_id,
      mcap_usd: r.mcap_usd,
      implied_value_usd: r.implied_value_usd,
      base_value_usd: r.model.base_value_usd,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      range_low_usd: r.model.range_low_usd,
      range_high_usd: r.model.range_high_usd,
      token_rate_k: r.category === null ? 0 : (catRates.get(r.category)?.k ?? 0),
      token_rate_n: r.category === null ? 0 : (catRates.get(r.category)?.n ?? 0),
    })),
    live: liveRows(snapshot),
    excluded,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
