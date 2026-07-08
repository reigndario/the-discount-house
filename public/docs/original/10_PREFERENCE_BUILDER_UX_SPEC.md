# Preference Builder UX Specification
## Confidential Vesting-Backed Credit Protocol — v0.5 UX Addendum

This document adds the user-experience and implementation model for the preference / constraint builder. It supersedes any earlier interpretation that preference cards are only exact term packages.

## 1. Core Philosophy

The protocol should not feel like a spreadsheet, an options-pricing tool, or a raw order book. Users should express what they are willing to accept in natural financial terms, while the protocol privately converts those preferences into a bounded optimization problem.

The core UX object is a **Preference Bundle**:

```text
Preference Bundle = acceptable constraint region + internal utility coloring + rank among other bundles
```

This gives users three intuitive controls:

1. **Hard constraints** — what terms are acceptable.
2. **Directional preferences** — within the acceptable region, which direction is better.
3. **Bundle rank** — which acceptable region is preferred over another.

The UI should not require users to understand Nash bargaining, utility functions, encrypted computation, or FHE. Those concepts belong in the implementation layer.

## 2. MVP Negotiated Fields

For MVP, each Preference Bundle covers exactly four negotiated fields:

- Principal
- Interest Rate
- Duration
- Grace Period

The system should remain extensible so additional fields can be added later without redesigning the UX or solver.

Future fields may include payment frequency, late fees, early repayment terms, start window, optional keeper reward, jurisdictional eligibility, or risk class.

## 3. UX Model

### 3.1 Bundle Cards

Each user creates one or more ranked Preference Bundles. Each bundle is displayed as a card with a human-readable summary.

Example borrower bundle:

```text
Best Case
Principal:     75k–100k cUSDC
Interest:      5.0%–8.0% APR
Duration:      12–24 months
Grace Period:  7–30 days
Preference:    more principal, lower rate, longer duration, longer grace
```

Bundles are ordered using drag-and-drop. Higher bundles are preferred over lower bundles.

### 3.2 Field Controls

Each field should be entered using constrained controls, not free-form financial formulas.

Recommended controls:

- Principal: min/max range with optional target.
- Interest Rate: min/max range depending on user role.
- Duration: min/max range with optional preferred target.
- Grace Period: min/max range with optional preferred target.

The interface should support both borrower and lender views.

For borrowers:

- Lower interest is typically better.
- Higher principal is typically better.
- Longer duration is typically better.
- Longer grace period is typically better.

For lenders:

- Higher interest is typically better.
- Lower principal exposure may be better unless they prefer deployment size.
- Shorter duration may be better unless they prefer locked yield.
- Shorter grace period may be better.

Defaults should be role-aware, but editable.

## 4. Utility Coloring

The visual model should show an acceptable region and color it according to preference intensity.

The visualization is a simplification of a multi-dimensional space. For MVP, use a 2D projection, for example:

```text
X-axis: Duration
Y-axis: Interest Rate
Color:  Relative preference inside the selected bundle
```

The colored region represents acceptable terms. The boundary represents hard constraints. The color gradient represents internal preference.

Suggested visual meaning:

- Green / strongest: most preferred area inside this bundle.
- Yellow / middle: acceptable but less preferred.
- Purple / weakest: still acceptable, but least preferred inside the bundle.

The user should understand that the visualization is illustrative. The actual solver evaluates all configured dimensions.

## 5. Implementation Model

### 5.1 Data Shape

A bundle should be represented as hard constraints plus simple per-field utility metadata.

```ts
type PreferenceDirection =
  | 'lower_is_better'
  | 'higher_is_better'
  | 'target_is_best'
  | 'neutral';

type Range<T> = {
  min: T;
  max: T;
  target?: T;
};

type FieldPreference<T> = {
  range: Range<T>;
  direction: PreferenceDirection;
  importance?: number; // bounded integer, optional for MVP
};

type PreferenceBundle = {
  bundleId: string;
  ownerRole: 'borrower' | 'lender';
  rank: number;
  label?: string;

  principal: FieldPreference<bigint>;
  interestBps: FieldPreference<number>;
  durationDays: FieldPreference<number>;
  gracePeriodDays: FieldPreference<number>;

  expiresAt?: number;
  active: boolean;
};
```

For MVP, `importance` can be optional or limited to a small set such as:

```text
low / normal / high
```

Avoid unbounded user-defined weights in v1.

### 5.2 Solver Treatment

The solver must not settle fuzzy terms. It settles exact terms.

Therefore:

```text
User inputs ranges and preferences.
Protocol expands them into bounded exact candidate packages.
Solver evaluates exact packages.
Loan settles exactly one package.
```

A candidate package is:

```ts
type CandidateTermPackage = {
  principal: bigint;
  interestBps: number;
  durationDays: number;
  gracePeriodDays: number;
};
```

### 5.3 Scoring

The solver should combine:

1. Bundle rank.
2. Field-level utility inside the bundle.
3. Feasibility against the counterparty bundle.
4. Nash-style combined surplus.

Conceptually:

```text
borrowerScore = rankScore + fieldUtility(candidate, borrowerBundle)
lenderScore   = rankScore + fieldUtility(candidate, lenderBundle)
nashScore     = borrowerScore * lenderScore
```

The exact scoring formula should use bounded integer arithmetic compatible with fhEVM. Floating point should not be used.

### 5.4 Field Utility

For each field:

- `lower_is_better`: best score at min, worst score at max.
- `higher_is_better`: best score at max, worst score at min.
- `target_is_best`: best score at target, decreasing as distance from target grows.
- `neutral`: constant score if within range.

All utility values should be normalized to bounded integers, for example `0..1000`.

### 5.5 Bundle Rank Utility

Bundle rank should dominate small field differences. A deal in Bundle 1 should generally be preferred over a slightly better-looking deal in Bundle 2 unless the implementation intentionally allows cross-bundle utility blending.

Recommended MVP approach:

```text
bundleRankBase = (maxRank - rank) * LARGE_CONSTANT
fieldUtility   = sum(field utilities)
totalUtility   = bundleRankBase + fieldUtility
```

This preserves the intuitive meaning of drag-and-drop ranking.

## 6. Privacy and Encryption

The following should be encrypted where feasible:

- Bundle ranges.
- Field preference directions if possible.
- Importance values.
- Candidate evaluation results.
- Selected final terms until revealed to parties.

The public system may still reveal:

- That a preference object exists.
- Coarse metadata used for discovery.
- Attempt timing.
- Match success/failure.

The UI should communicate this honestly: commercial preferences are confidential, but on-chain activity is not invisible.

## 7. UX Annotation Reference

The annotated mockup file is:

```text
10_PREFERENCE_BUILDER_UX_ANNOTATED.png
```

Annotation meanings:

1. **Ranked preference bundles** — the user orders acceptable regions by preference.
2. **Acceptable region + utility coloring** — hard constraints form the boundary; coloring shows internal preference.
3. **Privacy / optimization summary** — plain-language explanation of what the system does.
4. **Hard constraints per field** — ranges for principal, interest, duration, and grace period.
5. **Within-bundle importance** — optional lightweight priority controls.
6. **Bundle overview for review** — compact summary of all ranked regions.
7. **Encrypted save action** — preference data is encrypted before submission.

## 8. Codex Implementation Guidance

Codex should implement the builder as a modular component with the following layers:

```text
PreferenceBuilderPage
  ├── BundleRankList
  ├── BundleEditor
  │     ├── PrincipalControl
  │     ├── InterestControl
  │     ├── DurationControl
  │     └── GracePeriodControl
  ├── UtilityProjectionChart
  ├── BundleSummaryPanel
  └── SaveEncryptedPreferencesAction
```

The chart may be implemented as a deterministic client-side visualization. It does not need to exactly reproduce the encrypted solver output; it only needs to faithfully communicate the same model.

## 9. MVP Guardrails

Do not expose advanced concepts by default:

- Nash equilibrium
- surplus functions
- utility curves
- encrypted candidate grids
- solver internals

Use user-facing wording:

- “What would you accept?”
- “What do you prefer inside that range?”
- “Rank this bundle.”
- “Preview likely matches.”
- “Save encrypted preferences.”

Advanced mode may expose more detail later.

## 10. Product Positioning Note

This UX supports the protocol’s emerging positioning as a **Confidential Preference Book** rather than a conventional order book.

The product is not asking users to post a single bid or ask. It lets them privately describe acceptable regions of deal space, rank those regions, and allow the protocol to privately discover mutually beneficial agreements.
