# Conference previews — 2026 Week 5

All 138 rated FBS teams, assigned to the conferences in the supplied snapshot. Independents are a comparison group, not an actual conference. Charts use the selected publication and do not change its team ratings.

1. **Conference distributions:** every team logo at its actual rating; vertical staggering prevents collisions and carries no meaning. Conferences ordered by median rating. Tick marks indicate medians.
2. **1,000-game matchups:** 55 conference pairs, 1,000 games per pair, seed 20260929. Sample each team with equal probability within its conference, with replacement. Neutral-field expected margin is the rating difference. Add a sampled forecast error from 1816 available regular-season FBS-vs-FBS forecasts from the 2023–2025 backtest, randomly sign-flipped to avoid home/away orientation bias. Score ties, if any, get a fair coin winner. Each matchup is simulated once; the reverse cell is exactly complementary. No bookmaker line is used for simulated outcomes. The noise pool has RMS 16.11 points. No parameters were tuned to produce desired conference results.

The historical errors include model uncertainty, not just intrinsic randomness. A shared symmetric error distribution is a simplifying assumption; it ignores matchup-specific variance, spread-dependent errors, roster changes, and correlated results. These are illustrative simulations, **not calibrated win probabilities** or literal future schedules. Monte Carlo variation alone is roughly ±31 wins at a 50% rate in 1,000 independent draws; total modeling uncertainty is greater. Random pairings do not guarantee a balanced result. `ratingsOnlyWinsA` in the CSV shows automatic higher-rating-wins results for the exact same sampled pairings, without upset noise.

3. **Conference depth:** average top quarter and bottom quarter (round group size up), plus median. Conference size is not a strength bonus. Independents have only two teams, so their endpoints each represent one team.

All charts include PNG and SVG copies. Logos reuse the website's ESPN-sourced school assets; trademarks belong to their owners. All plotted values, simulation settings, and hashes are saved here. Reproduce from the football directory with `python conference_charts.py` (or publish the latest snapshot with `python share_cards.py`).
