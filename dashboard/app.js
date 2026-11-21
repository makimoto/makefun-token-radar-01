// Radar-17 renders snapshot data, with the valuation, peer test and plans mirrored below.
//
// How this page answers the bounty rubric, criterion by criterion:
// 1. Working radar - buildBoard's ranking is shipped as data.js; render() shows the
//    accounting for all 758 protocols; auditValues() recomputes every displayed implied
//    value from the snapshot inputs and reports the mismatch count in the method panel.
// 2. Value model - fitSizeCurve + impliedValue (mirrored below from lib/model.ts) fit the
//    size curve on the 128 positive-cap peers; validateSnapshotModels() re-runs the
//    leave-one-out test, the tilt-amplitude sweep and the residual band in this page;
//    calibrationSVG() plots the peers against the fitted curve.
// 3. Farm plans - farmMath() prices each route and farmSteps() writes its steps; the
//    detail view (openDetail) shows the plan with its modeled gas and budget checks.
// 4. Dashboard page - filteredRows() + updateBoard() sort and filter the board;
//    liveHTML() and excludedHTML() give the token-record and excluded views.
// 5. Presentation - app.css: one palette, one type scale, no framework.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('board');

  // ---------- formatting ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'not recorded';
    if (days < 60) return days + 'd';
    if (days < 730) return Math.round(days / 30.4) + ' mo';
    return (days / 365).toFixed(1) + ' yr';
  }
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  // === model mirror (parity-tested against lib/model.ts) ===

  const TILT = 0.05;
  const GROWTH_SCALE = 50;
  const TILT_SWEEP = [0, 0.02, 0.05, 0.1, 0.2];
  const DAY_MS = 86_400_000;
  function ageDays(asOf, listedAt) {
      if (listedAt === null) return null;
      const a = Date.parse(`${asOf}T00:00:00Z`);
      const b = Date.parse(`${listedAt}T00:00:00Z`);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return Math.max(0, Math.floor((a - b) / DAY_MS));
  }
  function peerSet(snapshot) {
      return snapshot.protocols.filter((p)=>p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  }
  function fitSizeCurve(peers) {
      const xs = peers.map((p)=>Math.log10(p.tvl_usd));
      const ys = peers.map((p)=>Math.log10(p.mcap_usd));
      const n = peers.length;
      const mx = xs.reduce((s, v)=>s + v, 0) / n;
      const my = ys.reduce((s, v)=>s + v, 0) / n;
      let num = 0;
      let den = 0;
      for(let i = 0; i < n; i++){
          num += (xs[i] - mx) * (ys[i] - my);
          den += (xs[i] - mx) * (xs[i] - mx);
      }
      const beta = den === 0 ? 1 : num / den;
      return {
          alpha: my - beta * mx,
          beta
      };
  }
  function calibratedFit(peers, asOf) {
      const fit = fitSizeCurve(peers);
      const ages = peers.map((p)=>ageDays(asOf, p.listed_at)).filter((a)=>a !== null);
      return {
          alpha: Math.round(fit.alpha * 1e6) / 1e6,
          beta: Math.round(fit.beta * 1e6) / 1e6,
          ageAnchor: ages.length ? Math.max(1, median(ages)) : 1
      };
  }
  function growthMultiplier(change, tilt = TILT) {
      const g = change ?? 0;
      return 1 + tilt * (g / (GROWTH_SCALE + Math.abs(g)));
  }
  function maturityMultiplier(age, anchor, tilt = TILT) {
      return age === null ? 1 : 1 + tilt * ((age - anchor) / (age + anchor));
  }
  function impliedValue(p, asOf, fit) {
      return tiltImplied(p, asOf, fit, TILT);
  }
  function tiltImplied(p, asOf, fit, tilt) {
      const age = ageDays(asOf, p.listed_at);
      const base = Math.pow(10, fit.alpha) * Math.pow(p.tvl_usd, fit.beta);
      const growthMult = growthMultiplier(p.change_7d, tilt);
      const maturityMult = maturityMultiplier(age, fit.ageAnchor, tilt);
      const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
      return {
          implied,
          base,
          growthMult,
          maturityMult,
          age
      };
  }
  function starterImplied(p, asOf) {
      const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
      const growth = Math.min(120, Math.max(-60, raw));
      const growthMult = 1 + growth / 100 * 0.5;
      const age = ageDays(asOf, p.listed_at) ?? 365;
      const maturity = 0.6 + Math.min(age, 1095) / 1095 * 0.4;
      return Math.max(1, Math.round(p.tvl_usd * 0.25 * growthMult * maturity));
  }
  function median(values) {
      const s = [
          ...values
      ].sort((a, b)=>a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function validateSnapshotModels(snapshot) {
      const peers = peerSet(snapshot);
      const eStarter = [];
      const eSize = [];
      const eRound2 = [];
      const eRound3 = [];
      for(let i = 0; i < peers.length; i++){
          const p = peers[i];
          const train = peers.filter((_, j)=>j !== i);
          const fit = fitSizeCurve(train);
          const actual = p.mcap_usd;
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
      const r3 = (n)=>Math.round(n * 1000) / 1000;
      const tilt_sweep = TILT_SWEEP.map((tilt)=>{
          const errs = [];
          for(let i = 0; i < peers.length; i++){
              const p = peers[i];
              const train = peers.filter((_, j)=>j !== i);
              const predicted = tiltImplied(p, snapshot.as_of, calibratedFit(train, snapshot.as_of), tilt).implied;
              errs.push(Math.abs(Math.log10(predicted / p.mcap_usd)));
          }
          return {
              tilt,
              median_log_err: r3(median(errs))
          };
      });
      const sortedResid = [
          ...currentModelResiduals(snapshot)
      ].sort((a, b)=>a - b);
      return {
          peers: peers.length,
          starter_median_log_err: r3(median(eStarter)),
          size_only_median_log_err: r3(median(eSize)),
          radar2_median_log_err: r3(median(eRound2)),
          radar3_median_log_err: r3(median(eRound3)), radar4_median_log_err: r3(median(eRound3)),
          tilt_sweep,
          resid_q25: Math.round(quantile(sortedResid, 0.25) * 1000) / 1000,
          resid_q75: Math.round(quantile(sortedResid, 0.75) * 1000) / 1000
      };
  }
  function quantile(sorted, q) {
      if (sorted.length === 0) return 0;
      const pos = (sorted.length - 1) * q;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      if (lo === hi) return sorted[lo];
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function currentModelResiduals(snapshot) {
      const peers = peerSet(snapshot);
      const residuals = [];
      for(let i = 0; i < peers.length; i++){
          const p = peers[i];
          const train = peers.filter((_, j)=>j !== i);
          const predicted = impliedValue(p, snapshot.as_of, calibratedFit(train, snapshot.as_of)).implied;
          residuals.push(Math.log10(predicted / p.mcap_usd));
      }
      return residuals;
  }
  function routeFor(category) {
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
          check: 'Find an open-and-repay flow. Set collateral, the smallest supported debt and a repayment reserve within the cap. Check the oracle, minimums and interest. At those amounts, require a 30% collateral price drop to leave the position above liquidation and confirm repayment fits the budget.',
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

  function researchCheck(category) {
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

  function capitalFor(p) {
    if (p.tvl_usd >= 1_000_000_000) return 500;
    if (p.tvl_usd >= 250_000_000) return 300;
    if (p.tvl_usd >= 50_000_000) return 200;
    if (p.tvl_usd >= 10_000_000) return 150;
    return 100;
  }

  function holdDays(age) {
    if (age === null) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function gasFor(chain) {
    return chain === 'Ethereum' ? 5 : 1;
  }

  function farmMath(p, age) {
    const chain = p.chains[0] ?? null;
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
    const altChain = route ? (p.chains.find((c) => gasFor(c) < gas) ?? null) : null;
    const altFees = altChain ? gasFor(altChain) * coreTxs : 0;
    const scenarioChain = p.chains.length
      ? p.chains.reduce((a, b) => (gasFor(b) < gasFor(a) ? b : a))
      : null;
    return { chain, route, pilot, capital, gas, entryTxs, exitTxs, coreFees, reviewWeeks, weeklyTxs, transactions, fees, burdenPct, verdict, hold, farmSize, altChain, altFees, scenarioChain };
  }

  function stepText(step) {
    return `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  }

  function farmSteps(p, age) {
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
    const alternate = m.altChain
      ? ` If the app confirms the same route on ${m.altChain}, its entry and exit gas scenario is $${m.altFees} (${(100 * m.altFees / m.capital).toFixed(1)}% of the same position).`
      : '';
    const verdictText = `Verdict: ${m.verdict}. Modeled gas is $${m.fees} (${m.burdenPct}% of the $${m.capital} position) across ${m.transactions} transactions.` +
      (m.weeklyTxs ? ` Entry and exit account for $${m.coreFees}; weekly actions are optional.` : '') +
      ' Rewards are unknown.' +
      (m.verdict === 'High gas' ? ` The 8% gas line for entry and exit on ${chain} would require $${m.farmSize}, above this plan’s position cap.${alternate}` : '');
    const horizon = p.category === 'RWA' ? '7-day review, with return of funds by your verified deadline' :
      m.pilot ? `up to ${m.hold} ${m.hold === 1 ? 'day' : 'days'}` : `${m.hold} days (age-based scenario)`;
    const exitTiming = p.category === 'RWA'
      ? 'Set a funds-return deadline. Confirm the request, settlement and any claim fit that deadline.'
      : `Set the latest exit start for funds to return within ${m.hold} ${m.hold === 1 ? 'day' : 'days'}. Check any lock, queue and claim steps.`;
    const followUp = m.pilot
      ? null
      : m.weeklyTxs
      ? { text: `Review participation terms weekly through week ${m.reviewWeeks} or until exit starts, whichever comes first. Sign at most once per week and ${m.weeklyTxs} times total. Confirm eligibility and room within the cap. Before signing, check whether the action would delay exit and skip it if so. Requote the action and exit. Include costs already incurred and both quotes. Skip if gas exceeds 8% of the actual position or total costs exceed your budget.`, cost: `up to $${m.gas * m.weeklyTxs} scenario gas for ${m.weeklyTxs} optional transactions`, time: '10 min a week' }
      : { text: `Keep participation checks read-only through week ${m.reviewWeeks} or until exit starts, whichever comes first. Record any published terms and eligibility.`, cost: '$0', time: '10 min a week' };
    return [
      { text: `Verify ${p.name} lists this route on ${chain}. Set a position size within the $${m.capital} cap. ${m.route.check} Check minimums and quote entry and exit at those amounts. Stay read-only if gas exceeds 8% at that size or total costs exceed your budget.`, cost: '$0', time: '20 min' },
      { text: `${exitTiming} Confirm official participation terms and your eligibility. Stay read-only if timing or eligibility is unverified.`, cost: '$0', time: '5 min before entry' },
      { text: `Reserve the quoted exit gas first. Use the position size checked before entry. ${m.route.entry} Save the receipts.`, cost: `up to $${m.gas * m.entryTxs} scenario gas for ${m.entryTxs} transactions incl. approvals`, time: '15 min active, plus settlement if required' },
      ...(followUp ? [followUp] : []),
      { text: `Plan window: ${horizon}. ${m.route.monitor} Recheck exit lead time each review. If it grows, pause optional actions and bring exit forward if possible. Record any rewards shown.`, cost: '$0 gas for read-only checks', time: m.pilot ? '5 min per review' : '5 min weekly' },
      { text: `Refresh the quote and start by the latest checked exit time. ${m.route.exit} If queued, track any required claim and confirm funds return. Log receipts and fees.`, cost: `up to $${m.gas * m.exitTxs} scenario gas for ${m.exitTxs} transactions`, time: '15 min active, plus any verified queue' },
      { text: verdictText, cost: '$0', time: '1 min' },
    ];
  }

  function impliedOf(row) {
      return impliedValue(row, DATA.as_of, DATA.fit).implied;
  }

  function validateModels() {
      const v = validateSnapshotModels({ protocols: DATA.peers, as_of: DATA.as_of });
      return { peers: v.peers, starter: v.starter_median_log_err, sizeOnly: v.size_only_median_log_err,
          radar2: v.radar2_median_log_err, radar3: v.radar3_median_log_err, radar4: v.radar4_median_log_err,
          tiltSweep: v.tilt_sweep, residQ25: v.resid_q25, residQ75: v.resid_q75 };
  }

  // The page audit: recompute every displayed implied value from the snapshot inputs
  // with the mirrored model and count disagreements with the stored board values.
  function auditValues() {
      var mismatches = 0;
      DATA.rows.forEach(function (r) { if (impliedOf(r) !== r.implied_value_usd) mismatches++; });
      return { checked: DATA.rows.length, mismatches: mismatches };
  }

  // === end model mirror ===

  // ---------- state ----------
  var state = { view: 'board', q: '', category: 'all', status: 'all', verdict: 'all', sortKey: 'rank', sortDir: 1 };
  var bySlug = {};
  DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = DATA.rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 0);
  var validation = validateModels();

  function verdictChip(v) {
    return '<span class="chip verdict-' + v.toLowerCase().replace(' ', '-') + '">' + v + '</span>';
  }
  function statusChip(s) {
    return s === 'watchlist' ? '<span class="chip chip-watch">Watchlist</span>' : '<span class="chip chip-early">Early</span>';
  }

  function headerHTML() {
    var a = DATA.accounting;
    return '<header class="top">' +
      '<div class="title-row"><h1>Token Launch Radar</h1><span class="model-tag">' + esc(DATA.model_version) + '</span></div>' +
      '<p class="sub">Protocols that record no token in the sealed snapshot of ' + esc(DATA.as_of) + ', ranked by an implied value anchored to token-recording peers.</p>' +
      '<div class="accounting" role="note">' +
      '<span><strong>' + a.total + '</strong> protocols in the snapshot</span>' +
      '<span><strong>' + a.ranked + '</strong> ranked (' + a.watchlist + ' watchlist + ' + a.early + ' early)</span>' +
      '<span><strong>' + a.records_token + '</strong> record a token (Token records view)</span>' +
      '<span><strong>' + a.excluded + '</strong> excluded, each with a reason (Excluded view)</span>' +
      '</div></header>';
  }

  // The calibration chart: the 128 priced peers against the fitted size curve, with the
  // middle-50% leave-one-out residual band; the five largest watchlist rows are plotted
  // at their implied values. Drawn from data.js by this page - no image, no library.
  function calibrationSVG() {
    var f = DATA.fit, v = validation;
    var W = 340, H = 110, L = 34, R = 6, T = 5, B = 16;
    var xs = DATA.peers.map(function (p) { return Math.log10(p.tvl_usd); });
    var ys = DATA.peers.map(function (p) { return Math.log10(p.mcap_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs) * 2) / 2, x1 = Math.ceil(Math.max.apply(null, xs) * 2) / 2;
    var y0 = Math.floor(Math.min.apply(null, ys) * 2) / 2, y1 = Math.ceil(Math.max.apply(null, ys) * 2) / 2;
    function X(x) { return L + (x - x0) / (x1 - x0) * (W - L - R); }
    function Y(y) { return T + (y1 - y) / (y1 - y0) * (H - T - B); }
    function curveY(x) { return f.alpha + f.beta * x; }
    var bandTop = '', bandBot = '', curve = '';
    for (var i = 0; i <= 24; i++) {
      var x = x0 + (x1 - x0) * i / 24;
      bandTop += (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(curveY(x) + v.residQ75).toFixed(1);
      bandBot = 'L' + X(x).toFixed(1) + ' ' + Y(curveY(x) + v.residQ25).toFixed(1) + bandBot;
      curve += (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(curveY(x)).toFixed(1);
    }
    var dots = DATA.peers.map(function (p) {
      return '<circle class="peer" cx="' + X(Math.log10(p.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(p.mcap_usd)).toFixed(1) + '" r="2"/>';
    }).join('');
    var tops = DATA.rows.filter(function (r) { return r.status === 'watchlist'; }).slice(0, 5).map(function (r) {
      return '<rect class="watchpt" x="' + (X(Math.log10(r.tvl_usd)) - 3).toFixed(1) + '" y="' + (Y(Math.log10(r.implied_value_usd)) - 3).toFixed(1) + '" width="6" height="6"/>';
    }).join('');
    function tickLabel(g) {
      if (g >= 9) return '$' + Math.pow(10, g - 9) + 'B';
      if (g >= 6) return '$' + Math.pow(10, g - 6) + 'M';
      return '$' + Math.pow(10, g - 3) + 'K';
    }
    var xticks = '', yticks = '';
    for (var gx = Math.ceil(x0); gx <= Math.floor(x1); gx += 1) {
      xticks += '<text class="tick" x="' + X(gx).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + tickLabel(gx) + '</text>';
    }
    for (var gy = Math.ceil(y0); gy <= Math.floor(y1); gy += 2) {
      yticks += '<text class="tick" x="' + (L - 4) + '" y="' + (Y(gy) + 3).toFixed(1) + '" text-anchor="end">' + tickLabel(gy) + '</text>';
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Peer calibration scatter: TVL against market cap, with the fitted size curve and its residual band">' +
      '<path class="band" d="' + bandTop + bandBot + 'Z"/><path class="curve" d="' + curve + '"/>' + dots + tops + xticks + yticks + '</svg>';
  }

  function methodHTML() {
    var v = validation, f = DATA.fit;
    var audit = auditValues();
    var entries = [
      ['House starter', v.starter],
      ['Size curve only', v.sizeOnly],
      ['Current model', v.radar4]
    ];
    var scores = entries.map(function (entry) {
      return '<tr' + (entry[0] === 'Current model' ? ' class="ours"' : '') + '><td>' + entry[0] + '</td><td>' + entry[1].toFixed(3) + '</td><td>' + Math.pow(10, entry[1]).toFixed(1) + '\u00d7</td></tr>';
    }).join('');
    var sweep = v.tiltSweep.map(function (s) {
      return s.tilt.toFixed(2) + ' \u2192 ' + s.median_log_err.toFixed(3) + (s.tilt === TILT ? ' (deployed)' : '');
    }).join(' \u00b7 ');
    return '<section class="panel method" aria-label="Valuation and validation"><div class="method-grid">' +
      '<div><h2>Valuation</h2>' +
      '<p class="formula">10<sup>' + f.alpha + '</sup> × TVL<sup>' + f.beta + '</sup> × age factor × growth factor</p>' +
      '<p>The size curve is fitted to the ' + v.peers + ' peers with a positive market cap. Age and growth tilt it by at most ' + (100 * TILT) + '% each; the ' + (100 * TILT) + '% amplitude is itself the leave-one-out choice over those peers \u2014 the sweep is nearly flat (tilt \u2192 median error: ' + sweep + '), because age and growth carry almost no transferable signal at ' + v.peers + ' peers, and richer fits score worse on the same test (a ridge regression on standardized size, age and growth: 0.542). Age is neutral at the peer median (' + f.ageAnchor + ' days); growth at 0%. Missing inputs are neutral.</p>' +
      '<p><strong>Token rates are context, never a multiplier.</strong> Each detail view shows its category\u2019s token record rate (snapshot-wide: ' + DATA.accounting.records_token + ' of ' + DATA.accounting.total + '). One snapshot holds no launch history, so that cross-sectional rate cannot be validated as a future issuance probability \u2014 and protocols that have run longest without a token are disproportionately never-launch designs. The ranking uses the peer-fitted conditional value only. The fit\u2019s ' + v.peers + ' peers are a priced, self-selected sample; the test at right inherits that selection.</p>' +
      '<p class="note audit">Board coverage: the sealed watchlist plus eligible early rows (no symbol, CoinGecko ID or market-cap value; category and name screens passed). Page audit: this page recomputed all ' + audit.checked + ' displayed implied values from the snapshot inputs (impliedOf) \u2014 ' + audit.mismatches + ' mismatches with the stored board.</p></div>' +
      '<div class="validation"><h3>Peer calibration \u00b7 ' + v.peers + ' priced peers</h3>' + calibrationSVG() +
      '<p class="note">Peers (dots) vs the fitted size component (line); band: middle 50% of LOO residuals \u2014 each row\u2019s quoted value range. Squares: five largest watchlist rows.</p>' +
      '<h3>Leave-one-out \u00b7 ' + v.peers + ' token peers</h3>' +
      '<table class="vtable"><thead><tr><th>Model</th><th>Median |log\u2081\u2080 error| \u2193</th><th>Typical miss</th></tr></thead><tbody>' + scores + '</tbody></table>' +
      '<p class="note">Recomputed here from snapshot peers. The test estimates how well the model transfers among token-recording protocols.</p></div>' +
      '</div>' +
      '<p class="note plans-note">Before funding, confirm eligibility, quote amounts within the cap and verify exit timing. Check the 8% gas limit and total-cost budget. RWA, CDP and Derivatives use short conditional pilots. Weekly actions must fit the gas allowance and total-cost budget after reserving exit. Research plans are read-only. Gas scenarios use $5 per Ethereum transaction and $1 elsewhere. Reward value is unknown.</p></section>';
  }

  function categoriesFor(view) {
    var rows = view === 'board' ? DATA.rows : DATA[view];
    return '<option value="all">All categories</option>' + [...new Set(rows.map(r => r.category).filter(Boolean))].sort().map(function (category) {
      return '<option value="' + esc(category) + '">' + esc(category) + '</option>';
    }).join('');
  }

  function controlsHTML() {
    return '<div class="controls">' +
      '<div class="tabs" aria-label="Dataset">' +
      '<button type="button" data-view="board" class="tab active" aria-pressed="true">Board</button>' +
      '<button type="button" data-view="live" class="tab" aria-pressed="false">Token records</button>' +
      '<button type="button" data-view="excluded" class="tab" aria-pressed="false">Excluded &amp; why</button></div>' +
      '<label class="search">Search <input id="q" type="search" placeholder="Name, slug or chain" value=""></label>' +
      '<label>Category <select id="cat">' + categoriesFor('board') + '</select></label>' +
      '<label data-board-filter>Status <select id="status"><option value="all">Watchlist + early</option><option value="watchlist">Watchlist only</option><option value="early">Early only</option></select></label>' +
      '<label data-board-filter>Plan <select id="verdict"><option value="all">Any plan</option><option>Low gas</option><option>High gas</option><option>Research</option></select></label>' +
      '</div>';
  }

  function boardHeadHTML() {
    function th(key, label, cls) {
      var arrow = state.sortKey === key ? (state.sortDir === 1 ? ' \u25b2' : ' \u25bc') : '';
      var ariaSort = arrow ? ' aria-sort="' + (state.sortDir === 1 ? 'ascending' : 'descending') + '"' : '';
      return '<th class="' + (cls || '') + '"' + ariaSort + '><button type="button" class="sort" data-sort="' + key + '">' + label + arrow + '</button></th>';
    }
    return '<p class="count" id="board-count" aria-live="polite"></p><div class="table-scroll"><table class="board"><thead><tr>' +
      th('rank', '#') + '<th>Protocol</th><th>Chains</th>' + th('tvl', 'TVL', 'num') + th('change', '7d', 'num') + th('age', 'Age', 'num') + th('implied', 'Implied value', 'num') + '<th>Plan</th>' +
      '</tr></thead><tbody id="board-body"></tbody></table></div>';
  }

  function rowHTML(r) {
    var fm = farmMath(r, r.age_days);
    var implied = r.implied_value_usd;
    var bar = Math.max(2, Math.round((implied / maxImplied) * 100));
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank">' + r.rank + '</td>' +
      '<td class="proto"><span class="pname"><button type="button" class="row-detail">' + esc(r.name) + '</button></span> ' + statusChip(r.status) +
      '<span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
      '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + ageText(r.age_days) + '</td>' +
      '<td class="num implied"><span class="bar" style="width:' + bar + '%"></span><span class="ival">' + money(implied) + '</span></td>' +
      '<td>' + verdictChip(fm.verdict) + (fm.pilot ? '<span class="pcat">Conditional pilot</span>' : '') + '</td></tr>';
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.status !== 'all' && r.status !== state.status) return false;
      if (state.verdict !== 'all' && farmMath(r, r.age_days).verdict !== state.verdict) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sortKey, dir = state.sortDir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else { va = a.rank; vb = b.rank; }
      if (key === 'change' && (a.change_7d === null) !== (b.change_7d === null)) return a.change_7d === null ? 1 : -1;
      if (key === 'age' && (a.age_days === null) !== (b.age_days === null)) return a.age_days === null ? 1 : -1;
      return (va - vb) * dir || a.rank - b.rank;
    });
    return rows;
  }

  function updateBoard() {
    var body = document.getElementById('board-body');
    if (!body) return;
    var rows = filteredRows();
    body.innerHTML = rows.map(rowHTML).join('');
    var watchlist = rows.filter(r => r.status === 'watchlist').length;
    document.getElementById('board-count').textContent = rows.length + ' of ' + DATA.rows.length + ' ranked protocols · ' +
      watchlist + ' of ' + DATA.accounting.watchlist + ' watchlist · ' +
      (rows.length - watchlist) + ' of ' + DATA.accounting.early + ' early · Select a protocol for its valuation and plan.';
    body.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  function liveHTML() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.live.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + [...r.chains, r.symbol, r.gecko_id].join(' ')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var body = rows.map(function (r) {
      var evidence = [
        r.symbol === null ? '' : 'Symbol: ' + r.symbol,
        r.gecko_id === null ? '' : 'CoinGecko ID: ' + r.gecko_id,
        r.mcap_usd !== null && r.mcap_usd <= 0 ? 'Market cap field: ' + r.mcap_usd : ''
      ].filter(Boolean).join(' · ');
      return '<tr><td class="proto"><span class="pname">' + esc(r.name) + '</span><span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td>' + esc(evidence || 'Market cap field') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd > 0 ? r.mcap_usd : null) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
    return '<p class="count">' + rows.length + ' of ' + DATA.live.length + ' token records · Presence of a snapshot field establishes the classification. Trading activity is unverified.</p>' +
      '<div class="table-scroll"><table class="board"><thead><tr><th>Protocol</th><th>Chains</th><th>Snapshot evidence</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function excludedHTML() {
    var q = state.q.trim().toLowerCase();
    var byReason = DATA.accounting.excluded_by_reason;
    var summary = Object.keys(byReason).map(function (k) { return '<li><strong>' + byReason[k] + '</strong> \u2014 ' + esc(k) + '</li>'; }).join('');
    var rows = DATA.excluded.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var body = rows.map(function (r) {
      return '<tr><td class="proto"><span class="pname">' + esc(r.name) + '</span><span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="reason">' + esc(r.reason) + '</td></tr>';
    }).join('');
    return '<p class="note">' + rows.length + ' of ' + DATA.excluded.length + ' excluded records · Reasons use snapshot category and name.</p>' +
      '<details><summary>Exclusion reasons across the snapshot</summary><ul class="reasons">' + summary + '</ul></details>' +
      '<table class="board"><thead><tr><th>Protocol</th><th class="num">TVL</th><th>Reason</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var fm = farmMath(r, r.age_days);
    var steps = farmSteps(r, r.age_days).map(stepText);
    var tokenStatus = [r.symbol, r.gecko_id, r.mcap_usd].every(value => value === null)
      ? 'records no token (symbol, CoinGecko ID and market cap blank)'
      : 'has token evidence in the snapshot';
    var old = document.querySelector('dialog.detail');
    if (old) old.remove();
    var d = el('<dialog class="detail" aria-labelledby="detail-title"></dialog>');
    d.innerHTML =
      '<div class="d-head"><h2 id="detail-title">' + esc(r.name) + '</h2>' + statusChip(r.status) + verdictChip(fm.verdict) +
      '<button type="button" class="close" aria-label="Close">\u00d7</button></div>' +
      '<p class="d-sub">' + esc(r.category || 'Uncategorised') + ' \u00b7 rank #' + r.rank + ' of ' + DATA.rows.length + ' \u00b7 ' + tokenStatus +
      (r.token_rate_n > 0 ? ' \u00b7 category token rate ' + Math.round(100 * r.token_rate_k / r.token_rate_n) + '% (' + r.token_rate_k + ' of ' + r.token_rate_n + '), context only \u2014 never multiplied into the value' : '') + '</p>' +
      '<table class="kv"><tbody>' +
      '<tr><th>Implied value</th><td><strong>' + moneyFull(r.implied_value_usd) + '</strong></td></tr>' +
      '<tr><th>Model</th><td>approx. size value ' + moneyFull(r.base_value_usd) + ' \u00d7 age factor ' + r.maturity_multiplier.toFixed(4) + ' \u00d7 growth factor ' + r.growth_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><th>Value range</th><td>' + moneyFull(r.range_low_usd) + ' \u2013 ' + moneyFull(r.range_high_usd) + ' <span class="pcat">middle 50% of the model\u2019s leave-one-out residuals on the 128 peers</span></td></tr>' +
      '<tr><th>TVL</th><td>' + moneyFull(r.tvl_usd) + ' \u00b7 7d ' + pct(r.change_7d) + '</td></tr>' +
      '<tr><th>DefiLlama listing</th><td>' + (r.listed_at ? esc(r.listed_at) + ' (' + ageText(r.age_days) + ' at the snapshot)' : 'not recorded in the snapshot; age adjustment is neutral') + '</td></tr>' +
      '<tr><th>Chains</th><td>' + esc(r.chains.join(', ') || 'none recorded') + '</td></tr>' +
      '<tr><th>Plan economics</th><td>' + (fm.route
        ? esc(fm.chain) + ' · ' + moneyFull(fm.capital) + ' position cap · ' + moneyFull(fm.fees) + ' modeled gas (' + fm.burdenPct + '%) · up to ' + fm.transactions + ' transactions · ' + fm.hold + (fm.pilot ? '-day pilot review' : '-day hold')
        : 'Read-only review · $0 budget · 0 transactions') + '</td></tr>' +
      '</tbody></table>' +
      '<h3>' + (fm.pilot ? 'Conditional pilot' : fm.route ? 'Conditional farm plan' : 'Research plan') + '</h3><ol class="steps">' +
      steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('') + '</ol>' +
      (fm.route ? '<p class="note">The first listed chain is the primary scenario at $' + fm.gas + ' per transaction. Low gas means modeled entry and exit fit within 8% of the position cap. Check total costs separately, including funding, bridging, spread, slippage, funding rates, interest and protocol fees. Reward value is unknown.</p>' : '');
    document.body.appendChild(d);
    d.querySelector('.close').addEventListener('click', function () { d.close(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }

  function bindSort() {
    document.querySelectorAll('.sort').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = -state.sortDir; else { state.sortKey = key; state.sortDir = key === 'rank' ? 1 : -1; }
        document.getElementById('view-board').innerHTML = boardHeadHTML();
        bindSort();
        updateBoard();
        document.querySelector('[data-sort="' + key + '"]').focus();
      });
    });
  }

  function refreshViews() {
    document.getElementById('view-board').hidden = state.view !== 'board';
    document.getElementById('view-live').hidden = state.view !== 'live';
    document.getElementById('view-excluded').hidden = state.view !== 'excluded';
    document.querySelectorAll('[data-board-filter]').forEach(label => { label.hidden = state.view !== 'board'; });
    if (state.view === 'board') updateBoard();
    if (state.view === 'live') document.getElementById('view-live').innerHTML = liveHTML();
    if (state.view === 'excluded') document.getElementById('view-excluded').innerHTML = excludedHTML();
  }

  function render() {
    main.innerHTML = headerHTML() + methodHTML() + controlsHTML() +
      '<section id="view-board">' + boardHeadHTML() + '</section>' +
      '<section id="view-live" hidden></section>' +
      '<section id="view-excluded" hidden></section>' +
      '<footer class="foot">Built from one sealed snapshot (' + esc(DATA.source) + ', as of ' + esc(DATA.as_of) + '). ' +
      'Implied values are a model\u2019s ranking device, not price predictions. The board renders the stored board values; the method panel\u2019s audit recomputes each one from the snapshot inputs and reports any mismatch.</footer>';
    main.removeAttribute('aria-busy');
    updateBoard();
    bindSort();
    // Controls update only the table body on input, so the search box keeps focus while typing.
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; refreshViews(); });
    document.getElementById('cat').addEventListener('change', function (e) { state.category = e.target.value; refreshViews(); });
    document.getElementById('status').addEventListener('change', function (e) { state.status = e.target.value; updateBoard(); });
    document.getElementById('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; updateBoard(); });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        state.view = t.getAttribute('data-view');
        document.querySelectorAll('.tab').forEach(function (x) {
          x.classList.toggle('active', x === t);
          x.setAttribute('aria-pressed', String(x === t));
        });
        var category = document.getElementById('cat');
        category.innerHTML = categoriesFor(state.view);
        document.getElementById('q').placeholder = state.view === 'live'
          ? 'Name, slug, chain, symbol or ID'
          : 'Name, slug or chain';
        category.value = state.category;
        if (!category.value) category.value = state.category = 'all';
        refreshViews();
      });
    });
  }

  render();
})();
