const STORAGE_KEY = "cvc-v06-state";
const APP_BUILD_ID = "20260708-credit-units-1";
const ONE_DAY = 24 * 60 * 60;
const PRIORITY_MIN = 1;
const PRIORITY_MAX = 5;
const EXECUTION_TERM_FIELD_COUNT = 6;
const DISCOVERY_LOOKBACK_BLOCKS = 250_000;
const DISCOVERY_CHUNK_BLOCKS = 20_000;
const DISCOVERY_POLL_INTERVAL_MS = 5_000;
const PREP_ENCRYPTION_TIMEOUT_MS = 60_000;
const PREP_WALLET_REQUEST_TIMEOUT_MS = 180_000;
const CREDIT_TOKEN_LABEL = "cUSDC";
const CREDIT_TOKEN_TECHNICAL_LABEL = "cUSDCMock";
const CREDIT_TOKEN_SHIELD_URL = "https://portfolio.zama.org/shield";
const CREDIT_TOKEN_DECIMALS = 6;
const PRINCIPAL_CEILING_BUCKETS = [50, 150, 500, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];
const DURATION_CEILING_BUCKETS = [180, 720, 1_460, 2_190, 3_650];
const PREFERENCE_STATUS = {
  None: 0,
  Submitted: 1,
  Cancelled: 2,
  Expired: 3,
  Superseded: 4,
  Executable: 5,
  Consumed: 6,
};
const LOAN_STATE = {
  0: "None",
  1: "AwaitingEscrow",
  2: "Active",
  3: "Repaid",
  4: "Defaulted",
  5: "Unwound",
};
const ERC7984_TOKEN_ABI = [
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
  "function confidentialTransferAndCall(address to, bytes32 encryptedAmount, bytes inputProof, bytes data) returns (bytes32)",
];
const ERC20_METADATA_ABI = ["function name() view returns (string)", "function symbol() view returns (string)"];
const TOKEN_OPS_MANAGER_ABI = [
  "function acceptVestingTransfer(bytes32 vestingId)",
  "function getPendingVestingTransfer(bytes32 vestingId) view returns (address newRecipient, uint48 initiatedAt, uint48 expiresAt)",
];
const PRIORITY_FIELDS = [
  { key: "collateralAmount", label: "Collateral" },
  { key: "principal", label: "Principal" },
  { key: "interestBps", label: "Rate" },
  { key: "durationDays", label: "Duration" },
  { key: "gracePeriodDays", label: "Grace" },
];
const FIELD_SLIDER_BOUNDS = {
  collateralAmount: [0, 500_000],
  principal: [0, 1_000],
  interestBps: [0, 25],
  durationDays: [0, 1_460],
  gracePeriodDays: [0, 120],
};
const SCARCE_CREDIT_DEMO_VERSION = 1;
const DEMO_PRINCIPAL_PRESETS = {
  borrower: [
    [50, 100, 100],
    [50, 100, 75],
    [25, 75, 50],
  ],
  lender: [
    [50, 100, 100],
    [50, 150, 100],
  ],
};
const GENERATED_BUNDLE_LABELS = new Set([
  "Best Case",
  "Balanced",
  "Fallback",
  "Capital Efficient",
  "Large Draw",
  "Short Bridge",
  "Fallback Terms",
  "Balanced Borrow",
  "Yield Seeking",
  "Senior Supply",
  "Deep Liquidity",
  "Short Duration",
  "Collateral Focused",
  "Balanced Supply",
]);
const MOCK_BACKED_LOAN_ACTIONS = new Set(["register-collateral", "fund", "repay"]);
const OFFER_PUBLISH_STEPS = [
  {
    key: "bundle",
    label: "Bundle",
    description: "Validate the active bundle against onboarded capital.",
  },
  {
    key: "preference",
    label: "Offer",
    description: "Submit encrypted preference handles to the public book.",
  },
  {
    key: "backing",
    label: "Backing",
    description: "Register the selected escrow or custody record as backing evidence.",
  },
  {
    key: "activate",
    label: "Executable",
    description: "Activate the backed offer for public bucket discovery and matching.",
  },
];

const emptyState = {
  nextBundleId: 1,
  nextMatchId: 1,
  nextLoanId: 1,
  role: "borrower",
  activeBundleId: null,
  activeLoanId: null,
  bundles: [],
  matches: [],
  loans: [],
  orderSave: {
    borrower: { changedAt: 0, savedAt: 0 },
    lender: { changedAt: 0, savedAt: 0 },
  },
  demoValueScaleVersion: SCARCE_CREDIT_DEMO_VERSION,
  demoUtils: {
    latestVestingToken: null,
    latestVestingManager: null,
    lastVestingId: null,
    borrowerPrep: null,
    lenderPrep: null,
    collateralAssets: [],
    collateralMetadata: {},
    borrowerCapital: [],
    lenderCapital: [],
    selectedBorrowerCapitalId: null,
    borrowerVestingAmount: null,
    borrowerTokenName: "Demo Vested Collateral",
    lenderEscrowAmount: null,
  },
  appHelp: {
    hideOnStart: false,
  },
};

let state = loadState();
let priorityDragPointerId = null;
let bundleDrag = null;
let fieldRangeDrag = null;
let discoveryPollTimer = null;
let suppressBundleClick = false;
let dragonRuntimeReady = false;
let dragonWelcomeStarted = false;
let initialWalletProbeComplete = false;
let dragonChoicePending = false;
let walletReconnectPausedUntil = 0;
const collateralMetadataRequests = new Set();
let appHelpOpenedThisSession = false;
let appHelpCloseTimer = null;
let offerPublishFlow = {
  open: false,
  busy: false,
  role: null,
  bundleId: null,
  currentStep: null,
  message: "",
  error: null,
  completed: [],
};
const contractState = {
  manifest: null,
  provider: null,
  readProvider: null,
  signer: null,
  account: null,
  chainId: null,
  walletProvider: null,
  walletProviderType: null,
  walletSource: null,
  relayerInstance: null,
  relayerConfigKey: null,
  discovery: liveDiscoveryDefaults(),
  discoveryBusy: false,
  executionBusy: false,
  executionNotice: null,
  loanActionNotice: null,
  shieldedCredit: {
    account: null,
    token: null,
    handle: null,
    available: false,
    busy: false,
    error: null,
    checkedAt: null,
  },
};
const warnedPlaceholders = new Set();
const el = {
  shell: document.querySelector(".app-shell"),
  workspace: document.querySelector(".workspace"),
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  viewTitle: document.querySelector("#view-title"),
  modeChip: document.querySelector("#mode-chip"),
  topbarNetworkStatus: document.querySelector("#topbar-network-status"),
  topbarConnectWallet: document.querySelector("#topbar-connect-wallet"),
  appHelp: document.querySelector("#app-help"),
  appHelpModal: document.querySelector("#app-help-modal"),
  appHelpClose: document.querySelector("#app-help-close"),
  appHelpDismiss: document.querySelector("#app-help-dismiss"),
  appHelpHideStart: document.querySelector("#app-help-hide-start"),
  resetDemo: document.querySelector("#reset-demo"),
  seedDemo: document.querySelector("#seed-demo"),
  roleToggleButtons: document.querySelectorAll(".role-toggle"),
  perspectiveButtons: document.querySelectorAll(".perspective"),
  builderSideButtons: document.querySelectorAll(".builder-side"),
  bucketSideFilter: document.querySelector("#bucket-side-filter"),
  userExecutableList: document.querySelector("#user-executable-list"),
  bucketList: document.querySelector("#bucket-list"),
  metricBundles: document.querySelector("#metric-bundles"),
  metricBuckets: document.querySelector("#metric-buckets"),
  metricBorrowerBuckets: document.querySelector("#metric-borrower-buckets"),
  metricLenderBuckets: document.querySelector("#metric-lender-buckets"),
  metricLoans: document.querySelector("#metric-loans"),
  metricAwaiting: document.querySelector("#metric-awaiting"),
  metricActiveLoans: document.querySelector("#metric-active-loans"),
  metricClosedLoans: document.querySelector("#metric-closed-loans"),
  addBundle: document.querySelector("#add-bundle"),
  saveOrdering: document.querySelector("#save-ordering"),
  orderSaveStatus: document.querySelector("#order-save-status"),
  bundleList: document.querySelector("#bundle-list"),
  activeBundleTitle: document.querySelector("#active-bundle-title"),
  activeSaveStatus: document.querySelector("#active-save-status"),
  fieldControls: document.querySelector("#field-controls"),
  savePreferences: document.querySelector("#save-preferences"),
  utilityChart: document.querySelector("#utility-chart"),
  collateralTokenAmount: document.querySelector("#collateral-token-amount"),
  impliedTokenPrice: document.querySelector("#implied-token-price"),
  collateralValue: document.querySelector("#collateral-value"),
  principalPreview: document.querySelector("#principal-preview"),
  ltvPreview: document.querySelector("#ltv-preview"),
  loanList: document.querySelector("#loan-list"),
  loanDetail: document.querySelector("#loan-detail"),
  loanRoleTitle: document.querySelector("#loan-role-title"),
  loanRoleCopy: document.querySelector("#loan-role-copy"),
  executionPanelTitle: document.querySelector("#execution-panel-title"),
  executionPanelCopy: document.querySelector("#execution-panel-copy"),
  executionStatus: document.querySelector("#execution-status"),
  executionBundle: document.querySelector("#execution-bundle"),
  executionBucket: document.querySelector("#execution-bucket"),
  executeBundle: document.querySelector("#execute-bundle"),
  executionSummary: document.querySelector("#execution-summary"),
  manifestNetwork: document.querySelector("#manifest-network"),
  preferenceBookAddress: document.querySelector("#preference-book-address"),
  manifestRpc: document.querySelector("#manifest-rpc"),
  walletAccount: document.querySelector("#wallet-account"),
  contractStatus: document.querySelector("#contract-status"),
  syncManifest: document.querySelector("#sync-manifest"),
  connectWallet: document.querySelector("#connect-wallet"),
  submitContract: document.querySelector("#submit-contract"),
  demoBorrowerCard: document.querySelector('[data-demo-role="borrower"]'),
  demoBorrowerStatus: document.querySelector("#demo-borrower-status"),
  demoBorrowerSteps: document.querySelector("#demo-borrower-steps"),
  demoBorrowerSummary: document.querySelector("#demo-borrower-summary"),
  demoPrepareBorrower: document.querySelector("#demo-prepare-borrower"),
  demoPrepareBorrowerNew: document.querySelector("#demo-prepare-borrower-new"),
  demoBorrowerBackingId: document.querySelector("#demo-borrower-backing-id"),
  demoLenderCard: document.querySelector('[data-demo-role="lender"]'),
  demoLenderStatus: document.querySelector("#demo-lender-status"),
  demoLenderSteps: document.querySelector("#demo-lender-steps"),
  demoLenderSummary: document.querySelector("#demo-lender-summary"),
  demoPrepareLender: document.querySelector("#demo-prepare-lender"),
  demoCheckShieldedCredit: document.querySelector("#demo-check-shielded-credit"),
  demoLenderShieldedStatus: document.querySelector("#demo-lender-shielded-status"),
  demoBorrowerVestingAmount: document.querySelector("#demo-borrower-vesting-amount"),
  demoBorrowerVestingSlider: document.querySelector("#demo-borrower-vesting-slider"),
  demoBorrowerTokenName: document.querySelector("#demo-borrower-token-name"),
  demoBorrowerCapitalPicker: document.querySelector("#demo-borrower-capital-picker"),
  demoBorrowerCapitalSelect: document.querySelector("#demo-borrower-capital-select"),
  demoBorrowerCapitalDetail: document.querySelector("#demo-borrower-capital-detail"),
  demoLenderEscrowAmount: document.querySelector("#demo-lender-escrow-amount"),
  demoLenderEscrowSlider: document.querySelector("#demo-lender-escrow-slider"),
  demoLenderCreditToken: document.querySelector("#demo-lender-credit-token"),
  demoLenderCommitment: document.querySelector("#demo-lender-commitment"),
  demoLenderBackingId: document.querySelector("#demo-lender-backing-id"),
  demoLenderPreferenceId: document.querySelector("#demo-lender-preference-id"),
  demoLatestToken: document.querySelector("#demo-latest-token"),
  demoLatestManager: document.querySelector("#demo-latest-manager"),
  collateralAssetSelect: document.querySelector("#collateral-asset-select"),
  collateralAssetAddress: document.querySelector("#collateral-asset-address"),
  demoLastVestingId: document.querySelector("#demo-last-vesting-id"),
  builderCapitalGate: document.querySelector("#builder-capital-gate"),
  offerPublishModal: document.querySelector("#offer-publish-modal"),
  offerPublishSteps: document.querySelector("#offer-publish-steps"),
  offerPublishMessage: document.querySelector("#offer-publish-message"),
  offerPublishClose: document.querySelector("#offer-publish-close"),
};

function liveDiscoveryDefaults() {
  return {
    status: "Not synced",
    updatedAt: null,
    scannedFrom: null,
    scannedTo: null,
    error: null,
    preferences: [],
    buckets: [],
    preferenceById: {},
    loans: [],
    loanById: {},
  };
}

init();

function init() {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
  bindNavigation();
  bindActions();
  bindDragonWelcome();
  loadDeploymentManifest();
  startDiscoveryPolling();
  probeInitialWalletConnection();
  if (state.bundles.length === 0) seedDemoData();
  ensureActiveBundle();
  saveState();
  render();
  resetPageScroll();
}

function startDiscoveryPolling() {
  if (discoveryPollTimer) return;
  discoveryPollTimer = window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    if (!contractState.manifest?.contracts?.ConfidentialPreferenceBook?.address) return;
    void refreshPublicBookDiscovery({ quiet: true });
  }, DISCOVERY_POLL_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!contractState.manifest?.contracts?.ConfidentialPreferenceBook?.address) return;
    void refreshPublicBookDiscovery({ quiet: true });
  });
}

function bindNavigation() {
  el.navItems.forEach((item) => {
    item.addEventListener("click", () => activateView(item.dataset.view));
  });
}

function bindActions() {
  el.resetDemo.addEventListener("click", () => {
    state = structuredClone(emptyState);
    saveState();
    render();
    showToast("Local cache reset.", "good");
  });

  el.seedDemo.addEventListener("click", () => {
    seedDemoData();
    render();
    showToast("Demo preference book seeded.", "good");
  });

  el.perspectiveButtons.forEach((button) => {
    button.addEventListener("click", () => {
      el.bucketSideFilter.value = button.dataset.perspective;
      renderBuckets();
    });
  });

  el.roleToggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveRole(button.dataset.role);
    });
  });

  el.builderSideButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveRole(button.dataset.side);
    });
  });

  document.querySelectorAll("[data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.viewJump));
  });

  el.addBundle.addEventListener("click", () => {
    const bundle = createBundle(state.role);
    state.activeBundleId = bundle.bundleId;
    normalizeRanks(state.role);
    touchOrder(state.role);
    saveState();
    render();
  });

  el.saveOrdering.addEventListener("click", () => {
    markOrderSaved(state.role);
    saveState();
    renderBundleList();
    renderOrderSaveStatus();
    showToast(`${capitalize(state.role)} ordering saved in this browser.`, "good");
  });

  el.bundleList.addEventListener("click", (event) => {
    if (suppressBundleClick) {
      suppressBundleClick = false;
      return;
    }
    const actionButton = event.target.closest("[data-bundle-action]");
    if (actionButton?.dataset.bundleAction === "remove") {
      removeBundle(actionButton.dataset.bundleId);
      return;
    }
    const card = event.target.closest("[data-bundle-id]");
    if (!card) return;

    const bundleId = card.dataset.bundleId;
    state.activeBundleId = bundleId;
    saveState();
    render();
  });

  el.bundleList.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    const card = event.target.closest("[data-bundle-id]");
    if (!card || event.button !== 0) return;
    bundleDrag = {
      pointerId: event.pointerId,
      bundleId: card.dataset.bundleId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - card.getBoundingClientRect().left,
      offsetY: event.clientY - card.getBoundingClientRect().top,
      targetId: null,
      active: false,
      ghost: null,
      placeholder: null,
    };
    card.setPointerCapture(event.pointerId);
  });

  el.bundleList.addEventListener("pointermove", (event) => {
    if (!bundleDrag || bundleDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const distance = Math.hypot(event.clientX - bundleDrag.startX, event.clientY - bundleDrag.startY);
    if (!bundleDrag.active && distance < 8) return;
    if (!bundleDrag.active) startBundleDragVisuals(event);
    const source = el.bundleList.querySelector(`[data-bundle-id="${bundleDrag.bundleId}"]`);
    if (!source) return;
    moveBundleGhost(event);
    updateBundlePlaceholder(event.clientY);
  });

  el.bundleList.addEventListener("pointerup", finishBundlePointerDrag);
  el.bundleList.addEventListener("pointercancel", finishBundlePointerDrag);

  el.fieldControls.addEventListener("input", (event) => {
    const input = event.target;
    const bundle = activeBundle();
    if (!bundle || !input.dataset.field) return;

    const field = bundle[input.dataset.field];
    field.range[input.dataset.prop] = Number(input.value);
    normalizeField(field);
    updateAutoBundleLabel(bundle);
    touchBundle(bundle);
    saveState();
    renderBundleList();
    renderBuilderOnly();
  });

  el.fieldControls.addEventListener("click", (event) => {
    const button = event.target.closest(".direction-option");
    const bundle = activeBundle();
    if (!button || !bundle) return;
    const field = bundle[button.dataset.field];
    field.direction = button.dataset.value;
    updateAutoBundleLabel(bundle);
    touchBundle(bundle);
    saveState();
    renderBundleList();
    renderBuilderOnly();
  });

  el.fieldControls.addEventListener("pointerdown", beginFieldRangeDrag);
  el.fieldControls.addEventListener("pointermove", moveFieldRangeDrag);
  el.fieldControls.addEventListener("pointerup", endFieldRangeDrag);
  el.fieldControls.addEventListener("pointercancel", endFieldRangeDrag);

  el.savePreferences.addEventListener("click", publishPrivateOffer);
  el.activeBundleTitle.addEventListener("focus", () => {
    const bundle = activeBundle();
    if (!bundle) return;
    bundle.labelEdited = true;
    touchBundle(bundle);
    saveState();
  });
  el.activeBundleTitle.addEventListener("input", () => {
    const bundle = activeBundle();
    if (!bundle) return;
    bundle.labelEdited = true;
    bundle.label = el.activeBundleTitle.value.trim() || classifyBundle(bundle);
    touchBundle(bundle);
    saveState();
    renderBundleList();
    renderActiveSaveStatus();
  });
  el.utilityChart?.addEventListener("pointerdown", beginPriorityDrag);
  el.utilityChart?.addEventListener("pointermove", movePriorityDrag);
  el.utilityChart?.addEventListener("pointerup", endPriorityDrag);
  el.utilityChart?.addEventListener("pointercancel", endPriorityDrag);
  el.syncManifest?.addEventListener("click", loadDeploymentManifest);
  el.connectWallet?.addEventListener("click", connectWallet);
  el.submitContract?.addEventListener("click", submitActivePreferenceBundle);
  el.topbarConnectWallet?.addEventListener("click", handleTopbarWalletClick);
  el.appHelp?.addEventListener("click", () => openAppHelpModal({ manual: true }));
  el.appHelpClose?.addEventListener("click", closeAppHelpModal);
  el.appHelpDismiss?.addEventListener("click", closeAppHelpModal);
  el.appHelpHideStart?.addEventListener("change", () => {
    state.appHelp ??= structuredClone(emptyState.appHelp);
    state.appHelp.hideOnStart = Boolean(el.appHelpHideStart.checked);
    saveState();
  });
  el.appHelpModal?.addEventListener("click", (event) => {
    if (event.target === el.appHelpModal || event.target.classList.contains("app-help-backdrop")) {
      closeAppHelpModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && el.appHelpModal && !el.appHelpModal.hidden) closeAppHelpModal();
  });
  el.demoPrepareBorrower?.addEventListener("click", () => prepareBorrowerPrerequisites());
  el.demoPrepareBorrowerNew?.addEventListener("click", () =>
    prepareBorrowerPrerequisites({ forceNewCollateral: true }),
  );
  el.demoPrepareLender?.addEventListener("click", prepareLenderPrerequisites);
  el.demoCheckShieldedCredit?.addEventListener("click", () => {
    void checkShieldedCreditReadiness({ quiet: false });
  });
  bindSyncedAmountInputs(el.demoBorrowerVestingAmount, el.demoBorrowerVestingSlider, "borrowerVestingAmount");
  el.demoBorrowerTokenName?.addEventListener("input", () => {
    state.demoUtils.borrowerTokenName = sanitizeTokenName(el.demoBorrowerTokenName.value);
    saveState();
  });
  bindSyncedAmountInputs(el.demoLenderEscrowAmount, el.demoLenderEscrowSlider, "lenderEscrowAmount");
  el.demoBorrowerCapitalSelect?.addEventListener("change", () => {
    selectBorrowerCapitalRecord(el.demoBorrowerCapitalSelect.value);
    render();
  });
  bindPrepStepperTooltips(el.demoBorrowerSteps);
  bindPrepStepperTooltips(el.demoLenderSteps);
  el.builderCapitalGate?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-capital-select]");
    const bundle = activeBundle();
    if (!select || !bundle) return;
    bundle.capitalRecordId = select.value;
    applySelectedCapitalToBundle(bundle);
    touchBundle(bundle);
    saveState();
    renderBuilderOnly();
    renderBundleList();
  });
  el.builderCapitalGate?.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-builder-jump-demo]");
    if (jump) activateView("demo-utils");
  });
  el.collateralAssetSelect?.addEventListener("change", () => {
    const bundle = activeBundle();
    const asset = collateralAssets().find((candidate) => candidate.id === el.collateralAssetSelect.value);
    if (!bundle || !asset) return;
    applyCollateralAssetToBundle(bundle, asset);
    touchBundle(bundle);
    saveState();
    renderBuilderOnly();
    renderBuckets();
  });

  el.collateralTokenAmount?.addEventListener("input", renderValuationHelper);
  el.impliedTokenPrice?.addEventListener("input", renderValuationHelper);
  el.loanList.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    const item = event.target.closest("[data-loan-id]");
    if (!item) return;
    state.activeLoanId = item.dataset.loanId;
    if (button?.dataset.action) await applyLoanAction(state.activeLoanId, button.dataset.action);
    saveState();
    renderLoans();
  });

  document.addEventListener("click", handleLoanDetailActionClick, true);

  el.executionBundle?.addEventListener("change", renderExecutionPanel);
  el.executionBucket?.addEventListener("change", renderExecutionSummary);
  el.executeBundle?.addEventListener("click", executeSelectedLiveMatch);
  el.offerPublishClose?.addEventListener("click", () => {
    if (offerPublishFlow.busy) return;
    offerPublishFlow.open = false;
    renderOfferPublishModal();
  });
}

function bindPrepStepperTooltips(container) {
  if (!container) return;
  container.addEventListener("pointerover", (event) => {
    const button = event.target.closest(".contract-stepper button");
    if (button && container.contains(button)) button.classList.add("tooltip-open");
  });
  container.addEventListener("pointerout", (event) => {
    const button = event.target.closest(".contract-stepper button");
    if (button && !button.contains(event.relatedTarget)) button.classList.remove("tooltip-open");
  });
  container.addEventListener("focusin", (event) => {
    const button = event.target.closest(".contract-stepper button");
    if (button && container.contains(button)) button.classList.add("tooltip-open");
  });
  container.addEventListener("focusout", (event) => {
    const button = event.target.closest(".contract-stepper button");
    if (button) button.classList.remove("tooltip-open");
  });
}

function bindSyncedAmountInputs(input, slider, stateKey) {
  if (!input || !slider) return;
  const update = (value) => {
    const amount = Math.max(1, Math.round(Number(value || 1)));
    state.demoUtils[stateKey] = amount;
    input.value = String(amount);
    slider.value = String(Math.min(Number(slider.max), amount));
    saveState();
    renderDemoUtils();
  };
  input.addEventListener("input", () => update(input.value));
  slider.addEventListener("input", () => update(slider.value));
}

function setActiveRole(role, options = {}) {
  if (role !== "borrower" && role !== "lender") return;
  const settings = { syncDragon: true, ...options };
  state.role = role;
  const firstForRole = sortedRoleBundles(state.role)[0];
  state.activeBundleId = firstForRole?.bundleId ?? createBundle(state.role).bundleId;
  if (activeView() === "book") {
    el.bucketSideFilter.value = oppositeRole(role);
  }
  saveState();
  if (settings.syncDragon) syncDragonModeToRole();
  render();
}

function setActiveRoleFromDragonSide(side, options = {}) {
  const role = roleForDragonSide(side);
  if (!role) return false;
  if (state.role === role) {
    if (options.renderWhenSame) render();
    return true;
  }
  setActiveRole(role, options);
  return true;
}

function bindDragonWelcome() {
  window.CVCDragonApp = {
    appBuildId: APP_BUILD_ID,
    connectWalletForDragon: connectWalletForDragon,
    debugLoanAction,
    hasUsableWalletConnection,
    setRoleFromDragonSide(side) {
      setActiveRoleFromDragonSide(side, { syncDragon: true });
    },
  };

  window.addEventListener("zahak:ready", () => {
    dragonRuntimeReady = true;
    syncDragonModeToRole();
    void maybeStartDragonWelcome();
  });

  window.addEventListener("zahak:choice", (event) => {
    const currentVibe = document.body.dataset.vibe;
    const shouldTrustChoice = !currentVibe || currentVibe === "mixed" || event.detail?.source === "api";
    if (shouldTrustChoice && setActiveRoleFromDragonSide(event.detail?.chosenSide, { syncDragon: false })) {
      dragonChoicePending = false;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.body.classList.add("dragon-entered");
      maybeOpenAppHelpModal();
    }
  });

  window.addEventListener("zahak:transition-start", (event) => {
    setActiveRoleFromDragonSide(event.detail?.toMode ?? event.detail?.to, { syncDragon: false });
  });

  window.addEventListener("zahak:transition-end", (event) => {
    dragonChoicePending = false;
    setActiveRoleFromDragonSide(event.detail?.toMode ?? event.detail?.to, {
      syncDragon: false,
      renderWhenSame: true,
    });
    document.body.classList.add("dragon-entered");
    maybeOpenAppHelpModal();
  });

  window.addEventListener("zahak:mode-change", (event) => {
    setActiveRoleFromDragonSide(event.detail?.mode, { syncDragon: false, renderWhenSame: true });
  });

  window.addEventListener("cvc:wallet-change", (event) => {
    if (!event.detail) {
      handleWalletDisconnect();
      return;
    }
    refreshWalletFromCurrentProvider();
  });

  if (window.ethereum?.on) {
    window.ethereum.on("accountsChanged", (accounts) => {
      if (!accounts?.length) {
        handleWalletDisconnect();
        return;
      }
      refreshWalletFromCurrentProvider();
    });
    window.ethereum.on("chainChanged", () => {
      if (!contractState.account) {
        renderContractConnection();
        return;
      }
      refreshWalletFromCurrentProvider();
    });
  }
}

function activeWalletProvider() {
  return contractState.walletProvider ?? window.ethereum ?? null;
}

function hasWalletConnector() {
  return Boolean(window.ethereum || window.CVCMetaMaskWallet?.isConfigured?.());
}

async function handleTopbarWalletClick() {
  if (contractState.account) {
    await disconnectWallet();
    return;
  }
  await connectWallet();
}

async function disconnectWallet() {
  const provider = contractState.walletProvider;
  const source = contractState.walletSource;
  walletReconnectPausedUntil = Date.now() + 2500;

  clearWalletConnection();
  renderContractConnection();
  returnToDragonWelcome();
  showToast("Wallet disconnected.", "good");

  try {
    if (source === "metamask-connect" && window.CVCMetaMaskWallet?.disconnect) {
      await window.CVCMetaMaskWallet.disconnect();
      return;
    }
    if (provider?.request) {
      await provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    }
  } catch {
    // Some injected wallets do not expose permission revocation; local disconnect still gates the app.
  }
}

function handleWalletDisconnect() {
  clearWalletConnection();
  renderContractConnection();
  returnToDragonWelcome();
}

function refreshWalletFromCurrentProvider() {
  if (Date.now() < walletReconnectPausedUntil) return;
  void connectWallet({ requestAccounts: false, quiet: true }).then(() => {
    void maybeStartDragonWelcome();
  });
}

async function probeInitialWalletConnection() {
  if (!window.ethereum) {
    initialWalletProbeComplete = true;
    void maybeStartDragonWelcome();
    return;
  }
  await connectWallet({ requestAccounts: false, quiet: true });
  initialWalletProbeComplete = true;
  void maybeStartDragonWelcome();
}

async function maybeStartDragonWelcome() {
  if (!dragonRuntimeReady) return;
  syncDragonModeToRole();

  if (hasUsableWalletConnection()) {
    document.body.classList.add("dragon-entered");
    maybeOpenAppHelpModal();
    return;
  }

  if (!initialWalletProbeComplete && window.ethereum) return;

  document.body.classList.remove("dragon-entered");
  if (dragonWelcomeStarted || !window.ZahakWelcome) return;
  dragonWelcomeStarted = true;
  window.ZahakWelcome.openWelcome({ fullscreen: true, instant: true, promptDelayMs: 0 });
}

function returnToDragonWelcome() {
  dragonChoicePending = false;
  dragonWelcomeStarted = false;
  document.body.classList.remove("dragon-entered");
  closeAppHelpModal();
  window.ZahakTransition?.setMode?.("mixed");
  window.ZahakWelcome?.openWelcome?.({ fullscreen: true, instant: true, promptDelayMs: 0 });
  dragonWelcomeStarted = Boolean(window.ZahakWelcome);
}

async function connectWalletForDragon() {
  const connected = await connectWallet({ forceRequest: true });
  if (!connected) return false;
  if (hasUsableWalletConnection()) {
    dragonChoicePending = true;
    syncDragonModeToRole();
    return true;
  }

  const switched = await switchToManifestChain();
  if (switched && hasUsableWalletConnection()) {
    dragonChoicePending = true;
    syncDragonModeToRole();
    return true;
  }

  if (contractState.manifest?.chainId) {
    showToast(`Switch wallet to chain ${contractState.manifest.chainId} before entering.`, "bad");
  }
  return false;
}

function syncDragonModeToRole() {
  if (!window.ZahakTransition) return;
  if (dragonChoicePending) {
    window.ZahakTransition.setMode("mixed");
    return;
  }
  if (hasUsableWalletConnection()) {
    window.ZahakTransition.setSide(dragonSideForRole(state.role));
    return;
  }
  window.ZahakTransition.setMode("mixed");
}

function roleForDragonSide(side) {
  if (side === "red") return "borrower";
  if (side === "blue") return "lender";
  return null;
}

function visualDragonRole() {
  return roleForDragonSide(document.body.dataset.vibe);
}

function dragonSideForRole(role) {
  return role === "lender" ? "blue" : "red";
}

function activateView(target) {
  el.shell.dataset.activeView = target;
  el.navItems.forEach((nav) => nav.classList.toggle("active", nav.dataset.view === target));
  el.views.forEach((view) => {
    const active = view.id === `view-${target}`;
    view.classList.toggle("active", active);
    if (active) el.viewTitle.textContent = view.dataset.title;
  });
  updateModeState(target);
  resetPageScroll();
}

function render() {
  ensureActiveBundle();
  const currentView = activeView();
  el.shell.dataset.activeView = currentView;
  updateModeState(currentView);
  renderMetrics();
  renderBuckets();
  renderRoleChrome();
  renderBuilder();
  renderLoans();
  renderContractConnection();
  renderDemoUtils();
  renderOfferPublishModal();
  maybeOpenAppHelpModal();
}

function shouldShowAppHelpOnStart() {
  return Boolean(
    contractState.account &&
    document.body.classList.contains("dragon-entered") &&
    !document.querySelector(".private-lore-modal"),
  );
}

function maybeOpenAppHelpModal() {
  if (appHelpOpenedThisSession) return;
  if (state.appHelp?.hideOnStart) return;
  if (!shouldShowAppHelpOnStart()) return;
  openAppHelpModal({ manual: false });
}

function openAppHelpModal({ manual = true } = {}) {
  if (!el.appHelpModal) return;
  state.appHelp ??= structuredClone(emptyState.appHelp);
  appHelpOpenedThisSession = true;
  if (appHelpCloseTimer !== null) {
    window.clearTimeout(appHelpCloseTimer);
    appHelpCloseTimer = null;
  }
  if (el.appHelpHideStart) {
    el.appHelpHideStart.checked = Boolean(state.appHelp.hideOnStart);
  }
  el.appHelpModal.hidden = false;
  document.body.classList.add("app-help-open");
  requestAnimationFrame(() => {
    el.appHelpModal?.classList.add("is-visible");
    if (manual) el.appHelpClose?.focus({ preventScroll: true });
  });
}

function closeAppHelpModal() {
  if (!el.appHelpModal || el.appHelpModal.hidden) return;
  state.appHelp ??= structuredClone(emptyState.appHelp);
  state.appHelp.hideOnStart = Boolean(el.appHelpHideStart?.checked);
  saveState();
  el.appHelpModal.classList.remove("is-visible");
  document.body.classList.remove("app-help-open");
  appHelpCloseTimer = window.setTimeout(() => {
    appHelpCloseTimer = null;
    if (el.appHelpModal) el.appHelpModal.hidden = true;
  }, 180);
}

function renderRoleChrome() {
  el.roleToggleButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.role === state.role);
  });
}

function renderMetrics() {
  const active = state.bundles.filter((bundle) => bundle.active);
  const buckets = displayBuckets();
  el.metricBundles.textContent = active.length;
  el.metricBuckets.textContent = buckets.length;
  el.metricBorrowerBuckets.textContent = buckets.filter((bucket) => bucket.side === "borrower").length;
  el.metricLenderBuckets.textContent = buckets.filter((bucket) => bucket.side === "lender").length;
  if (el.metricLoans) {
    const loans = displayLoans();
    const closed = loans.filter((loan) => ["Repaid", "Defaulted", "Unwound"].includes(loan.status));
    el.metricLoans.textContent = loans.length;
    el.metricAwaiting.textContent = loans.filter((loan) => loan.status === "AwaitingEscrow").length;
    el.metricActiveLoans.textContent = loans.filter((loan) => loan.status === "Active").length;
    el.metricClosedLoans.textContent = closed.length;
  }
}

function renderBuckets() {
  const side = el.bucketSideFilter?.value ?? "all";
  if (activeView() === "book") updateModeState("book");
  el.perspectiveButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.perspective === side);
  });

  const buckets = displayBuckets().filter((bucket) => side === "all" || bucket.side === side);
  renderUserExecutableOffers(el.userExecutableList, userExecutableOffers("all"));
  renderBucketList(el.bucketList, buckets);
}

function activeView() {
  return [...el.views].find((view) => view.classList.contains("active"))?.id.replace("view-", "") ?? "book";
}

function resetPageScroll() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    el.workspace?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
  });
}

function updateModeState(target) {
  let mode = "combined";
  let label = "Combined Book";
  if (target === "borrower" || (target === "builder" && state.role === "borrower")) {
    mode = "borrower";
    label = "Borrower Lens";
  } else if (target === "lender" || (target === "builder" && state.role === "lender")) {
    mode = "lender";
    label = "Lender Lens";
  } else if (target === "loans") {
    mode = state.role;
    label = state.role === "borrower" ? "Borrower Loans" : "Lender Loans";
  }
  if (target === "book") {
    mode = state.role;
    label = state.role === "borrower" ? "Borrower View" : "Lender View";
  }
  el.shell.dataset.mode = mode;
  if (el.modeChip) el.modeChip.querySelector("strong").textContent = label;
}

function renderBucketList(container, buckets) {
  if (!container) return;
  container.innerHTML = "";
  if (buckets.length === 0) {
    container.innerHTML = '<div class="empty-state">No public buckets yet.</div>';
    return;
  }

  buckets.forEach((bucket) => {
    const item = document.createElement("article");
    item.className = "bucket";
    item.innerHTML = `
      <div class="bucket-head">
        <div>
          <span class="badge ${bucket.side}">${bucket.side === "borrower" ? "Demand" : "Supply"}</span>
          <h3>${escapeHtml(collateralMarketLabel(bucket))}</h3>
        </div>
        <strong>${bucket.count} bundles</strong>
      </div>
      <div class="bucket-meta">
        <div><span>Source</span><strong>${escapeHtml(bucket.sourceLabel ?? "Public index")}</strong></div>
        <div><span>Principal bucket</span><strong>${escapeHtml(bucket.principalBucket)}</strong></div>
        <div><span>Duration bucket</span><strong>${escapeHtml(bucket.durationBucket)}</strong></div>
        <div><span>Expiry</span><strong>${bucket.expiryDays}d</strong></div>
        <div><span>Public id</span><strong>${escapeHtml(bucket.id)}</strong></div>
      </div>
    `;
    container.appendChild(item);
  });
}

function userExecutableOffers(side) {
  if (!contractState.account) return [];
  const byPreferenceId = new Map();

  sortedRoleBundles("borrower")
    .concat(sortedRoleBundles("lender"))
    .filter((bundle) => side === "all" || bundle.ownerRole === side)
    .forEach((bundle) => {
      const livePreference = livePreferenceById(bundle.contractPreferenceId);
      if (!livePreference || !preferenceIsExecutable(livePreference)) return;
      const localOwnerMatches =
        bundle.contractOwnerAddress && equalAddress(bundle.contractOwnerAddress, contractState.account);
      const chainOwnerMatches = livePreference.manager && equalAddress(livePreference.manager, contractState.account);
      if (localOwnerMatches || chainOwnerMatches) {
        byPreferenceId.set(String(livePreference.preferenceId).toLowerCase(), { bundle, livePreference });
      }
    });

  (contractState.discovery?.preferences ?? []).forEach((livePreference) => {
    if (!preferenceIsExecutable(livePreference)) return;
    if (side !== "all" && livePreference.side !== side) return;
    if (!livePreference.manager || !equalAddress(livePreference.manager, contractState.account)) return;
    const id = String(livePreference.preferenceId).toLowerCase();
    if (!byPreferenceId.has(id)) byPreferenceId.set(id, { bundle: null, livePreference });
  });

  return [...byPreferenceId.values()].sort(
    (a, b) => Number(b.livePreference.blockNumber ?? 0) - Number(a.livePreference.blockNumber ?? 0),
  );
}

function renderUserExecutableOffers(container, offers) {
  if (!container) return;
  container.innerHTML = "";
  if (!contractState.account) {
    container.innerHTML = '<div class="empty-state">Connect wallet to show your executable offers.</div>';
    return;
  }
  if (offers.length === 0) {
    container.innerHTML = '<div class="empty-state">No executable offers from this wallet.</div>';
    return;
  }

  offers.forEach(({ bundle, livePreference }) => {
    const role = bundle?.ownerRole ?? livePreference.side;
    const sideLabel = role === "borrower" ? "Demand" : "Supply";
    const label = bundle?.label ?? `Offer ${shortHash(livePreference.preferenceId)}`;
    const item = document.createElement("article");
    item.className = "offer-card";
    item.innerHTML = `
      <div class="offer-head">
        <div>
          <span class="badge ${role}">${sideLabel}</span>
          <h3>${escapeHtml(label)}</h3>
        </div>
        <strong>Executable</strong>
      </div>
      <div class="offer-meta">
        <div><span>Source</span><strong>On-chain + local</strong></div>
        <div><span>Principal bucket</span><strong>${escapeHtml(livePreference.principalBucket ?? "Unknown")}</strong></div>
        <div><span>Duration bucket</span><strong>${escapeHtml(livePreference.durationBucket ?? "Unknown")}</strong></div>
        <div><span>Collateral market</span><strong>${escapeHtml(preferenceCollateralLabel(livePreference))}</strong></div>
        <div><span>Preference id</span><strong>${shortHash(livePreference.preferenceId)}</strong></div>
        <div><span>Expires</span><strong>${formatExpiry(livePreference.expiry)}</strong></div>
      </div>
    `;
    container.appendChild(item);
  });
}

function preferenceIsExecutable(preference) {
  if (!preference) return false;
  const status = Number(preference.status);
  if (Number.isFinite(status) && status !== PREFERENCE_STATUS.Executable) return false;
  return Number(preference.expiry ?? 0) > Math.floor(Date.now() / 1000);
}

function formatExpiry(expirySeconds) {
  if (!Number.isFinite(Number(expirySeconds))) return "Unknown";
  const remainingDays = Math.max(0, Math.ceil((Number(expirySeconds) - Math.floor(Date.now() / 1000)) / ONE_DAY));
  return `${remainingDays}d`;
}

function preferenceCollateralLabel(preference) {
  return collateralMarketLabel(preference);
}

function renderBuilder() {
  el.builderSideButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.side === state.role);
  });
  renderBundleList();
  renderOrderSaveStatus();
  renderBuilderOnly();
}

function renderBuilderOnly() {
  const bundle = activeBundle();
  if (!bundle) return;
  applySelectedCapitalToBundle(bundle);
  updateAutoBundleLabel(bundle);
  syncBundleLabelInput(bundle);
  renderActiveSaveStatus();
  renderBuilderCapitalGate(bundle);
  renderFieldControls(bundle);
  renderCollateralSelector(bundle);
  drawPriorityPolygon(bundle);
  renderValuationHelper();
  renderContractConnection();
}

function renderContractConnection() {
  const preferenceBook = contractState.manifest?.contracts?.ConfidentialPreferenceBook;
  if (el.manifestNetwork) {
    el.manifestNetwork.textContent = contractState.manifest
      ? `${contractState.manifest.network} (${contractState.manifest.chainId})`
      : "Not loaded";
  }
  if (el.preferenceBookAddress) {
    el.preferenceBookAddress.textContent = preferenceBook?.address
      ? shortAddress(preferenceBook.address)
      : "Unavailable";
  }
  if (el.manifestRpc) {
    el.manifestRpc.textContent = contractState.manifest?.rpcUrl ? "Hidden path available" : "Unavailable";
    el.manifestRpc.title = contractState.manifest?.rpcUrl ?? "";
  }
  if (el.walletAccount) {
    el.walletAccount.textContent = contractState.account ? shortAddress(contractState.account) : "Disconnected";
  }

  let connectionStatus = "Ready";
  let statusTone = "saved";
  if (!contractState.manifest) {
    connectionStatus = "Manifest missing";
    statusTone = "unsaved";
  } else if (!hasWalletConnector()) {
    connectionStatus = "Wallet unavailable";
    statusTone = "unsaved";
  } else if (!contractState.account) {
    connectionStatus = "Ready for wallet";
    statusTone = "unsaved";
  } else if (String(contractState.chainId ?? "") !== String(contractState.manifest.chainId)) {
    connectionStatus = `Wrong chain ${contractState.chainId}`;
    statusTone = "unsaved";
  } else if (!window.relayerSDK) {
    connectionStatus = "Relayer SDK unavailable";
    statusTone = "unsaved";
  } else if (!relayerConfigForManifest()) {
    connectionStatus = "Relayer config missing";
    statusTone = "unsaved";
  } else if (!hasContractCollateralConfig(activeBundle())) {
    connectionStatus = "Collateral unconfigured";
    statusTone = "unsaved";
  } else {
    connectionStatus = "Ready to encrypt";
  }

  if (el.contractStatus) {
    el.contractStatus.textContent = connectionStatus;
  }

  if (el.topbarNetworkStatus) {
    const network = contractState.manifest?.network ?? "No manifest";
    el.topbarNetworkStatus.textContent = contractState.account ? network : connectionStatus;
    el.topbarNetworkStatus.className = `wallet-status ${statusTone}`;
    el.topbarNetworkStatus.title = connectionStatus;
  }

  if (el.topbarConnectWallet) {
    el.topbarConnectWallet.textContent = contractState.account ? shortAddress(contractState.account) : "Connect Wallet";
    el.topbarConnectWallet.title = contractState.account ? "Disconnect wallet and return to welcome" : "Connect wallet";
    el.topbarConnectWallet.setAttribute("aria-label", el.topbarConnectWallet.title);
  }

  if (el.submitContract) {
    el.submitContract.disabled = !canSubmitContractBundle();
  }
}

function renderDemoUtils() {
  if (!el.demoBorrowerStatus) return;

  ensureDemoPrepState();
  reconcileDemoPrepState();
  const demoRole = state.role === "lender" ? "lender" : "borrower";
  setDemoRoleCardVisibility(el.demoBorrowerCard, demoRole === "borrower");
  setDemoRoleCardVisibility(el.demoLenderCard, demoRole === "lender");

  const connected = demoWalletReady();
  const borrowerBundle = demoRole === "borrower" ? topRoleBundle("borrower") : sortedRoleBundles("borrower")[0];
  const lenderBundle = demoRole === "lender" ? topRoleBundle("lender") : sortedRoleBundles("lender")[0];
  const borrowerPrep = state.demoUtils.borrowerPrep;
  const lenderPrep = state.demoUtils.lenderPrep;
  seedDemoCapitalInputs(borrowerBundle, lenderBundle);
  syncDemoCapitalControls();
  const borrowerSteps = borrowerPrepSteps(borrowerPrep);
  const lenderSteps = lenderPrepSteps(lenderPrep);
  const borrowerReady = connected && borrowerPrereqBlocker(borrowerBundle) === null;
  const lenderReady = connected && lenderPrereqBlocker(lenderBundle) === null;

  if (el.demoBorrowerTokenName) {
    el.demoBorrowerTokenName.value = currentBorrowerTokenName();
  }
  renderPrepStepper(el.demoBorrowerSteps, borrowerSteps, borrowerPrep.currentStep);
  renderPrepStepper(el.demoLenderSteps, lenderSteps, lenderPrep.currentStep);
  renderPrepStatus(
    el.demoBorrowerStatus,
    borrowerSteps,
    borrowerPrep.busy,
    borrowerReady,
    borrowerPrereqBlocker(borrowerBundle),
    {
      complete: "Collateral Onboarded Successfully",
      busy: borrowerPrep.message ?? "Onboarding",
      ready: "Ready",
    },
  );
  renderPrepStatus(el.demoLenderStatus, lenderSteps, lenderPrep.busy, lenderReady, lenderPrereqBlocker(lenderBundle), {
    complete: "Credit Escrowed Successfully",
    busy: lenderPrep.message ?? "Escrowing",
    ready: "Ready",
  });

  el.demoPrepareBorrower.disabled = !borrowerReady || borrowerPrep.busy;
  el.demoPrepareBorrower.textContent = borrowerPrep.busy ? "Onboarding..." : "Onboard Collateral";
  if (el.demoPrepareBorrowerNew) {
    el.demoPrepareBorrowerNew.disabled = !borrowerReady || borrowerPrep.busy;
    el.demoPrepareBorrowerNew.textContent = borrowerPrep.busy ? "Onboarding..." : "Onboard New Token";
  }
  el.demoPrepareLender.disabled = !lenderReady || lenderPrep.busy;
  el.demoPrepareLender.textContent = lenderPrep.busy ? "Escrowing..." : `Escrow Lender ${CREDIT_TOKEN_LABEL}`;
  if (el.demoCheckShieldedCredit) {
    el.demoCheckShieldedCredit.disabled =
      !connected || !contractState.manifest?.assets?.confidentialCreditToken || contractState.shieldedCredit.busy;
  }

  el.demoBorrowerSummary.innerHTML = prepSummaryHtml([
    ["Collateral name", currentBorrowerTokenName()],
    ["New custody amount", `${formatTokenAmount(borrowerOnboardAmount())} tokens`],
    ["Custodied positions", borrowerCapitalRecords().length],
  ]);
  el.demoLenderSummary.innerHTML = prepSummaryHtml([
    ["New escrow amount", `${formatUsd(lenderOnboardAmount())} ${CREDIT_TOKEN_LABEL}`],
    ["Available escrows", availableLenderCapital().length],
    ["Credit adapter", manifestContractEntry("ERC7984CreditAdapter")?.address ?? "Missing"],
  ]);
  renderShieldedCreditStatus();

  setAddressText(el.demoLatestToken, borrowerPrep.tokenAddress ?? state.demoUtils.latestVestingToken);
  setAddressText(el.demoLatestManager, borrowerPrep.managerAddress ?? state.demoUtils.latestVestingManager);
  setHashText(el.demoLastVestingId, borrowerPrep.vestingId ?? state.demoUtils.lastVestingId);
  renderBorrowerCapitalPicker();
  setHashText(el.demoBorrowerBackingId, selectedBorrowerCapitalRecord()?.vestingId ?? borrowerPrep.vestingId);
  const creditTokenAddress = contractState.manifest?.assets?.confidentialCreditToken;
  setAddressText(el.demoLenderCreditToken, creditTokenAddress);
  if (creditTokenAddress && el.demoLenderCreditToken) {
    el.demoLenderCreditToken.title = `${CREDIT_TOKEN_TECHNICAL_LABEL}: ${creditTokenAddress}`;
  }
  setHashText(el.demoLenderCommitment, latestAvailableLenderCapital()?.commitmentHash ?? lenderPrep.commitmentHash);
  setHashText(el.demoLenderBackingId, latestAvailableLenderCapital()?.commitmentHash ?? null);
  setHashText(el.demoLenderPreferenceId, lenderBundle?.contractPreferenceId ?? lenderPrep.preferenceId);
}

function renderShieldedCreditStatus() {
  if (!el.demoLenderShieldedStatus) return;

  const status = contractState.shieldedCredit;
  const tokenAddress = contractState.manifest?.assets?.confidentialCreditToken ?? null;
  const currentStatus =
    status?.account &&
    status?.token &&
    contractState.account &&
    tokenAddress &&
    equalAddress(status.account, contractState.account) &&
    equalAddress(status.token, tokenAddress);
  const shieldLink = `<a href="${CREDIT_TOKEN_SHIELD_URL}" target="_blank" rel="noreferrer">Zama Shield</a>`;
  let tone = "neutral";
  let message = `Lender escrow spends shielded ${CREDIT_TOKEN_LABEL}. Check readiness or shield ${CREDIT_TOKEN_LABEL} in ${shieldLink}.`;

  if (!contractState.account) {
    message = `Connect wallet to check shielded ${CREDIT_TOKEN_LABEL} readiness.`;
  } else if (!tokenAddress) {
    tone = "bad";
    message = `${CREDIT_TOKEN_LABEL} token missing from the deployment manifest.`;
  } else if (status.busy && currentStatus) {
    message = `Checking shielded ${CREDIT_TOKEN_LABEL} balance handle.`;
  } else if (status.error && currentStatus) {
    tone = "bad";
    message = `Could not check shielded ${CREDIT_TOKEN_LABEL}: ${escapeHtml(status.error)}`;
  } else if (currentStatus && status.available) {
    tone = "good";
    message = `Shielded ${CREDIT_TOKEN_LABEL} handle detected. Exact balance is private; escrow may still fail if the shielded amount is insufficient.`;
  } else if (currentStatus) {
    tone = "bad";
    message = `No shielded ${CREDIT_TOKEN_LABEL} handle detected. Shield ${CREDIT_TOKEN_LABEL} in ${shieldLink}, then retry.`;
  }

  el.demoLenderShieldedStatus.className = `shielded-credit-status ${tone}`;
  el.demoLenderShieldedStatus.innerHTML = message;
}

function setDemoRoleCardVisibility(card, visible) {
  if (!card) return;
  card.hidden = !visible;
  card.classList.toggle("is-hidden", !visible);
  card.setAttribute("aria-hidden", visible ? "false" : "true");
  card.style.display = visible ? "" : "none";
}

function renderBorrowerCapitalPicker() {
  if (!el.demoBorrowerCapitalPicker || !el.demoBorrowerCapitalSelect || !el.demoBorrowerCapitalDetail) return;
  const records = borrowerCapitalRecords();
  const selected = selectedBorrowerCapitalRecord();
  el.demoBorrowerCapitalPicker.hidden = records.length === 0;
  el.demoBorrowerCapitalSelect.innerHTML = "";
  records.forEach((record, index) => {
    const option = document.createElement("option");
    option.value = record.id;
    option.textContent = borrowerCapitalOptionLabel(record, index);
    el.demoBorrowerCapitalSelect.appendChild(option);
  });
  if (selected) {
    el.demoBorrowerCapitalSelect.value = selected.id;
    el.demoBorrowerCapitalDetail.textContent = `${displayTokenName(selected)} | ${formatTokenAmount(selected.amount)} tokens | ${shortAddress(selected.tokenAddress)} | ${shortHash(selected.vestingId)}`;
    el.demoBorrowerCapitalDetail.title = `${selected.amount} tokens | token ${selected.tokenAddress} | manager ${selected.managerAddress} | vesting ${selected.vestingId}`;
  } else {
    el.demoBorrowerCapitalDetail.textContent = "No positions";
    el.demoBorrowerCapitalDetail.title = "";
  }
}

function borrowerCapitalOptionLabel(record, index) {
  const token = record.tokenAddress ? shortAddress(record.tokenAddress) : "token pending";
  const manager = record.managerAddress ? shortAddress(record.managerAddress) : "manager pending";
  return `Position ${index + 1} | ${displayTokenName(record)} | ${formatTokenAmount(record.amount)} tokens | ${token} | ${manager}`;
}

function topRoleBundle(role) {
  return sortedRoleBundles(role)[0] ?? createBundle(role);
}

function ensureDemoPrepState() {
  state.demoUtils.borrowerCapital ??= [];
  state.demoUtils.lenderCapital ??= [];
  state.demoUtils.borrowerPrep = {
    busy: false,
    currentStep: null,
    startedAt: null,
    runId: null,
    completedSteps: [],
    tokenAddress: null,
    managerAddress: null,
    vestingId: null,
    custodyAccepted: false,
    backingRegistered: false,
    preferenceId: null,
    activated: false,
    ...(state.demoUtils.borrowerPrep ?? {}),
  };
  state.demoUtils.lenderPrep = {
    busy: false,
    currentStep: null,
    startedAt: null,
    runId: null,
    completedSteps: [],
    commitmentHash: null,
    commitmentExpiry: null,
    message: null,
    creditRegistered: false,
    commitmentEscrowed: false,
    backingRegistered: false,
    preferenceId: null,
    activated: false,
    ...(state.demoUtils.lenderPrep ?? {}),
  };
}

function reconcileDemoPrepState() {
  const borrowerRecord = latestAvailableBorrowerCapital();
  const borrowerPrep = state.demoUtils.borrowerPrep;
  if (borrowerRecord && demoRecordCompletesPrep(borrowerRecord, borrowerPrep)) {
    const selectedRecord = selectedBorrowerCapitalRecord() ?? borrowerRecord;
    state.demoUtils.selectedBorrowerCapitalId = selectedRecord.id;
    syncBorrowerPrepToCapital(selectedRecord);
  }

  const lenderRecord = latestAvailableLenderCapital();
  const lenderPrep = state.demoUtils.lenderPrep;
  if (lenderRecord && demoRecordCompletesPrep(lenderRecord, lenderPrep)) {
    lenderPrep.commitmentHash = lenderRecord.commitmentHash ?? lenderPrep.commitmentHash;
    lenderPrep.commitmentExpiry = lenderRecord.commitmentExpiry ?? lenderPrep.commitmentExpiry;
    lenderPrep.creditRegistered = true;
    lenderPrep.commitmentEscrowed = true;
    lenderPrep.busy = false;
    lenderPrep.currentStep = null;
    lenderPrep.startedAt = null;
    lenderPrep.runId = null;
    lenderPrep.completedSteps = ["amount", "commitment", "credit"];
  }
}

function demoRecordCompletesPrep(record, prep) {
  if (!record) return false;
  if (!prep?.busy) return true;
  if (prep.runId) return record.onboardingRunId === prep.runId;
  const startedAt = Number(prep.startedAt ?? 0);
  return Boolean(startedAt && Number(record.createdAt ?? 0) >= startedAt);
}

function seedDemoCapitalInputs(borrowerBundle, lenderBundle) {
  if (!state.demoUtils.borrowerVestingAmount && borrowerBundle) {
    state.demoUtils.borrowerVestingAmount = Math.max(
      1,
      Math.round(Number(borrowerBundle.collateralAmount.range.target)),
    );
  }
  if (!state.demoUtils.lenderEscrowAmount && lenderBundle) {
    state.demoUtils.lenderEscrowAmount = Math.max(1, Math.round(Number(lenderBundle.principal.range.target)));
  }
}

function syncDemoCapitalControls() {
  syncAmountControl(el.demoBorrowerVestingAmount, el.demoBorrowerVestingSlider, borrowerOnboardAmount());
  syncAmountControl(el.demoLenderEscrowAmount, el.demoLenderEscrowSlider, lenderOnboardAmount());
}

function syncAmountControl(input, slider, amount) {
  if (input) input.value = String(amount);
  if (slider) {
    slider.max = String(Math.max(Number(slider.max || 1), amount));
    slider.value = String(Math.min(Number(slider.max), amount));
  }
}

function borrowerOnboardAmount() {
  return Math.max(1, Math.round(Number(state.demoUtils.borrowerVestingAmount ?? 1)));
}

function lenderOnboardAmount() {
  return Math.max(1, Math.round(Number(state.demoUtils.lenderEscrowAmount ?? 1)));
}

function formatTokenAmount(value) {
  return Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function newCapitalRecordId(role) {
  return `${role}-capital-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function capitalOwnerMatches(record) {
  return Boolean(
    !record.ownerAddress || !contractState.account || equalAddress(record.ownerAddress, contractState.account),
  );
}

function availableBorrowerCapital(bundle = activeBundle()) {
  return (state.demoUtils.borrowerCapital ?? []).filter(
    (record) =>
      record.custodyAccepted &&
      capitalOwnerMatches(record) &&
      (!record.usedByBundleId || record.usedByBundleId === bundle?.bundleId),
  );
}

function borrowerCapitalRecords() {
  return (state.demoUtils.borrowerCapital ?? []).filter(
    (record) => record.custodyAccepted && capitalOwnerMatches(record),
  );
}

function selectedBorrowerCapitalRecord() {
  const records = borrowerCapitalRecords();
  if (!records.length) return null;
  return records.find((record) => record.id === state.demoUtils.selectedBorrowerCapitalId) ?? records.at(-1);
}

function selectBorrowerCapitalRecord(recordId) {
  const record =
    borrowerCapitalRecords().find((candidate) => candidate.id === recordId) ?? selectedBorrowerCapitalRecord();
  if (!record) return;
  state.demoUtils.selectedBorrowerCapitalId = record.id;
  syncBorrowerPrepToCapital(record);

  const bundle = sortedRoleBundles("borrower")[0] ?? null;
  if (bundle) {
    bundle.capitalRecordId = record.id;
    applySelectedCapitalToBundle(bundle);
    touchBundle(bundle);
  }
  saveState();
}

function syncBorrowerPrepToCapital(record) {
  if (!record) return;
  const prep = state.demoUtils.borrowerPrep;
  prep.tokenAddress = record.tokenAddress ?? prep.tokenAddress;
  prep.managerAddress = record.managerAddress ?? prep.managerAddress;
  prep.vestingId = record.vestingId ?? prep.vestingId;
  prep.custodyAccepted = true;
  prep.busy = false;
  prep.currentStep = null;
  prep.startedAt = null;
  prep.runId = null;
  prep.completedSteps = ["collateral", "vesting", "custody"];
  state.demoUtils.latestVestingToken = record.tokenAddress ?? state.demoUtils.latestVestingToken;
  state.demoUtils.latestVestingManager = record.managerAddress ?? state.demoUtils.latestVestingManager;
  state.demoUtils.lastVestingId = record.vestingId ?? state.demoUtils.lastVestingId;
}

function availableLenderCapital(bundle = activeBundle()) {
  return (state.demoUtils.lenderCapital ?? []).filter(
    (record) =>
      record.commitmentEscrowed &&
      scaledLenderCapitalRecord(record) &&
      capitalOwnerMatches(record) &&
      (!record.usedByBundleId || record.usedByBundleId === bundle?.bundleId),
  );
}

function scaledLenderCapitalRecord(record) {
  if (!record?.chainAmount) return false;
  try {
    return BigInt(record.chainAmount) >= creditDisplayToBaseUnits(record.amount ?? 0);
  } catch {
    return false;
  }
}

function latestAvailableBorrowerCapital() {
  return mostRecentCapitalRecord(availableBorrowerCapital(null));
}

function latestAvailableLenderCapital() {
  return mostRecentCapitalRecord(availableLenderCapital(null));
}

function selectedCapitalRecord(bundle = activeBundle()) {
  if (!bundle) return null;
  const records = bundle.ownerRole === "lender" ? availableLenderCapital(bundle) : availableBorrowerCapital(bundle);
  return records.find((record) => record.id === bundle.capitalRecordId) ?? mostRecentCapitalRecord(records);
}

function mostRecentCapitalRecord(records) {
  return [...(records ?? [])].sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)).at(-1) ?? null;
}

function applySelectedCapitalToBundle(bundle) {
  const record = selectedCapitalRecord(bundle);
  if (!record) return;
  bundle.capitalRecordId = record.id;
  if (bundle.ownerRole === "borrower") {
    applyCollateralAssetToBundle(bundle, {
      label: record.label,
      tokenName: record.tokenName,
      tokenSymbol: record.tokenSymbol,
      tokenAddress: record.tokenAddress,
      managerAddress: record.managerAddress,
    });
    clampFieldToCap(bundle.collateralAmount, Number(record.amount));
  } else {
    clampFieldToCap(bundle.principal, Number(record.amount));
    ensureBundleCollateralAsset(bundle);
  }
}

function clampFieldToCap(field, cap) {
  if (!field || !Number.isFinite(cap) || cap <= 0) return;
  field.range.min = Math.min(field.range.min, cap);
  field.range.max = Math.min(field.range.max, cap);
  field.range.target = Math.min(field.range.target, cap);
  normalizeField(field);
}

function borrowerPrepSteps(prep) {
  return [
    {
      key: "collateral",
      label: "Collateral",
      done: prepStepDone(prep, "collateral", Boolean(prep.tokenAddress && prep.managerAddress)),
      description: "Deploys or reuses demo collateral token and vesting manager for this borrower bundle.",
    },
    {
      key: "vesting",
      label: "Vesting",
      done: prepStepDone(prep, "vesting", Boolean(prep.vestingId)),
      description: "Creates a demo vesting position sized to the bundle's collateral target.",
    },
    {
      key: "custody",
      label: "Custody",
      done: prepStepDone(prep, "custody", Boolean(prep.custodyAccepted)),
      description: "Transfers the vesting position into the TokenOps adapter so it can back the offer.",
    },
  ];
}

function lenderPrepSteps(prep) {
  return [
    {
      key: "amount",
      label: "Amount",
      done: lenderOnboardAmount() > 0,
      description: `Choose the shielded ${CREDIT_TOKEN_LABEL} amount to escrow.`,
    },
    {
      key: "commitment",
      label: "Commitment",
      done: prepStepDone(prep, "commitment", Boolean(prep.creditRegistered)),
      description: "Register the lender credit commitment hash.",
    },
    {
      key: "credit",
      label: "Credit",
      done: prepStepDone(prep, "credit", Boolean(prep.commitmentEscrowed)),
      description: `Transfer shielded ${CREDIT_TOKEN_LABEL} into the adapter for this commitment.`,
    },
  ];
}

function prepStepDone(prep, step, fallback) {
  if (prep?.busy) return prep.completedSteps?.includes(step) ?? false;
  return Boolean(fallback || prep?.completedSteps?.includes(step));
}

function renderPrepStepper(container, steps, activeKey) {
  if (!container) return;
  container.innerHTML = steps
    .map((step) => {
      const klass = step.done ? "done" : step.key === activeKey ? "active" : "";
      const description = escapeHtml(step.description ?? step.label);
      const stateLabel = step.done ? "Done" : step.key === activeKey ? "Running" : "Pending";
      return `<button class="${klass}" type="button" tabindex="0" data-tooltip="${description}" aria-label="${escapeHtml(`${step.label}: ${stateLabel}. ${step.description ?? ""}`)}"><span>${escapeHtml(step.label)}</span><small>${stateLabel}</small></button>`;
    })
    .join("");
}

function renderPrepStatus(element, steps, busy, ready, blocker, labels = {}) {
  if (!element) return;
  const complete = steps.every((step) => step.done);
  element.textContent = complete
    ? (labels.complete ?? "Complete")
    : busy
      ? (labels.busy ?? "Running")
      : ready
        ? (labels.ready ?? "Ready")
        : (blocker ?? labels.blocked ?? "Blocked");
  element.title = element.textContent;
  element.className = `save-status ${complete || ready ? "saved" : "unsaved"}`;
}

function prepSummaryHtml(rows) {
  return rows
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(prepDisplayValue(value))}</strong></div>`,
    )
    .join("");
}

function prepDisplayValue(value) {
  if (!value) return "None";
  if (typeof value === "string" && window.ethers?.isAddress?.(value)) return shortAddress(value);
  if (typeof value === "string" && value.startsWith("0x") && value.length > 18) return shortHash(value);
  return String(value);
}

function setAddressText(element, value) {
  if (!element) return;
  element.textContent = value ? shortAddress(value) : "None";
  element.title = value ?? "";
}

function setHashText(element, value) {
  if (!element) return;
  element.textContent = value ? shortHash(value) : "None";
  element.title = value ?? "";
}

function borrowerPrereqBlocker(bundle) {
  const base = commonPrepBlocker(bundle);
  if (base) return base;
  if (!manifestContractEntry("TokenOpsVestingAdapter")?.address) return "Adapter missing";
  if (!hasDemoArtifact("DemoVestingToken") || !hasDemoArtifact("DemoTokenOpsVestingFactory"))
    return "Artifacts missing";
  return null;
}

function lenderPrereqBlocker(bundle) {
  const base = commonPrepBlocker(bundle);
  if (base) return base;
  if (!contractState.manifest?.assets?.confidentialCreditToken) return "Credit token missing";
  if (!manifestContractEntry("ERC7984CreditAdapter")?.address) return "Credit adapter missing";
  return null;
}

async function checkShieldedCreditReadiness(options = {}) {
  const quiet = Boolean(options.quiet);
  const account = contractState.account;
  const tokenAddress = contractState.manifest?.assets?.confidentialCreditToken ?? null;

  if (!window.ethers || !account || !tokenAddress) {
    const message = !account
      ? "Connect wallet before checking shielded credit."
      : `${CREDIT_TOKEN_LABEL} token missing from the deployment manifest.`;
    contractState.shieldedCredit = {
      account,
      token: tokenAddress,
      handle: null,
      available: false,
      busy: false,
      error: message,
      checkedAt: Date.now(),
    };
    renderShieldedCreditStatus();
    if (!quiet) showToast(message, "bad");
    return { available: false, error: message };
  }

  contractState.shieldedCredit = {
    account,
    token: tokenAddress,
    handle: null,
    available: false,
    busy: true,
    error: null,
    checkedAt: Date.now(),
  };
  renderShieldedCreditStatus();

  try {
    const token = confidentialCreditTokenContract(contractState.provider ?? publicReadProvider());
    const rawHandle = await token.confidentialBalanceOf(account);
    const handle = bytes32OrZero(rawHandle);
    const available = handle !== window.ethers.ZeroHash;
    contractState.shieldedCredit = {
      account,
      token: tokenAddress,
      handle,
      available,
      busy: false,
      error: null,
      checkedAt: Date.now(),
    };
    renderShieldedCreditStatus();
    if (!quiet) {
      showToast(
        available
          ? `Shielded ${CREDIT_TOKEN_LABEL} handle detected.`
          : `No shielded ${CREDIT_TOKEN_LABEL} handle detected.`,
        available ? "good" : "bad",
      );
    }
    return { available, handle };
  } catch (error) {
    const message = contractError(error, `Could not check shielded ${CREDIT_TOKEN_LABEL}.`);
    contractState.shieldedCredit = {
      account,
      token: tokenAddress,
      handle: null,
      available: false,
      busy: false,
      error: message,
      checkedAt: Date.now(),
    };
    renderShieldedCreditStatus();
    if (!quiet) showToast(message, "bad");
    return { available: false, error: message };
  }
}

function commonPrepBlocker(bundle) {
  if (!bundle) return "No bundle";
  if (!contractState.manifest) return "Manifest missing";
  if (!contractState.account) return "Connect wallet";
  if (String(contractState.chainId ?? "") !== String(contractState.manifest.chainId))
    return `Wrong chain ${contractState.chainId}`;
  if (!window.relayerSDK || !relayerConfigForManifest()) return "Relayer unavailable";
  if (!manifestContractEntry("ConfidentialPreferenceBook")?.address) return "Book missing";
  return null;
}

function lenderCommitmentAmount(bundle) {
  return creditDisplayToBaseUnits(Math.max(1, Math.round(bundle.principal.range.target)));
}

function borrowerVestingAmount(bundle) {
  return positiveTokenAmount(String(Math.max(1, Math.round(bundle.collateralAmount.range.target))));
}

function renderCollateralSelector(bundle) {
  if (!el.collateralAssetSelect || !el.collateralAssetAddress) return;

  const assets = collateralAssets();
  const activeAsset = collateralAssetForBundle(bundle);
  ensureBundleCollateralAsset(bundle, activeAsset);
  el.collateralAssetSelect.innerHTML = "";
  assets.forEach((asset) => {
    requestCollateralMetadata(asset);
    const option = document.createElement("option");
    option.value = asset.id;
    option.textContent = collateralAssetOptionLabel(asset);
    option.title = collateralAssetTitle(asset);
    el.collateralAssetSelect.appendChild(option);
  });
  el.collateralAssetSelect.value = activeAsset.id;
  el.collateralAssetAddress.textContent = collateralAssetOptionLabel(activeAsset);
  el.collateralAssetAddress.title = collateralAssetTitle(activeAsset);
}

async function prepareBorrowerPrerequisites(options = {}) {
  ensureDemoPrepState();
  const forceNewCollateral = Boolean(options.forceNewCollateral);
  const bundle = sortedRoleBundles("borrower")[0] ?? null;
  const blocker = borrowerPrereqBlocker(bundle);
  if (blocker) {
    showToast(blocker, "bad");
    return;
  }

  const prep = state.demoUtils.borrowerPrep;
  const onboardingRunId = newCapitalRecordId("borrower-run");
  prep.busy = true;
  prep.currentStep = "collateral";
  prep.startedAt = Date.now();
  prep.runId = onboardingRunId;
  prep.completedSteps = [];
  if (forceNewCollateral) {
    prep.tokenAddress = null;
    prep.managerAddress = null;
  }
  prep.vestingId = null;
  prep.custodyAccepted = false;
  saveState();
  renderDemoUtils();

  try {
    const { tokenAddress, managerAddress } = await ensureDemoCollateralPair({ forceNewCollateral });
    prep.tokenAddress = tokenAddress;
    prep.managerAddress = managerAddress;
    completePrepStep("borrower", "collateral");
    applyCollateralAssetToBundle(bundle, {
      label: collateralAssetLabel(tokenAddress),
      tokenAddress,
      managerAddress,
    });
    touchBundle(bundle);
    saveState();
    renderDemoUtils();

    const manager = demoContractAt("DemoTokenOpsVestingFactory", managerAddress, contractState.signer);
    const adapterAddress = manifestContractEntry("TokenOpsVestingAdapter").address;

    setPrepStep("borrower", "vesting", "Creating borrower vesting position.");
    const displayAmount = borrowerOnboardAmount();
    const amount = positiveTokenAmount(String(displayAmount));
    prep.vestingId = await manager.createDemoVesting.staticCall(contractState.account, amount);
    await (await manager.createDemoVesting(contractState.account, amount)).wait();
    state.demoUtils.lastVestingId = prep.vestingId;
    completePrepStep("borrower", "vesting");
    saveState();

    setPrepStep("borrower", "custody", "Transferring vesting position into adapter custody.");
    await (await manager.initiateVestingTransfer(prep.vestingId, adapterAddress, 86_400)).wait();
    await (
      await contractFor("TokenOpsVestingAdapter", contractState.signer).acceptPendingVestingTransfer(
        managerAddress,
        prep.vestingId,
        contractState.account,
      )
    ).wait();
    prep.custodyAccepted = true;
    completePrepStep("borrower", "custody");
    const record = {
      id: newCapitalRecordId("borrower"),
      label: collateralAssetLabel(tokenAddress),
      tokenName: collateralMetadataFor(tokenAddress)?.tokenName ?? collateralAssetLabel(tokenAddress),
      tokenSymbol: collateralMetadataFor(tokenAddress)?.tokenSymbol ?? null,
      ownerAddress: contractState.account,
      tokenAddress,
      managerAddress,
      vestingId: prep.vestingId,
      amount: displayAmount,
      chainAmount: amount.toString(),
      custodyAccepted: true,
      usedByBundleId: null,
      createdAt: Date.now(),
      onboardingRunId,
    };
    state.demoUtils.borrowerCapital.push(record);
    state.demoUtils.selectedBorrowerCapitalId = record.id;
    syncBorrowerPrepToCapital(record);
    saveState();
    showToast("Borrower collateral is in custody. Build and publish an offer from Builder.", "good");
  } catch (error) {
    showToast(contractError(error, "Borrower capital onboarding failed."), "bad");
  } finally {
    prep.busy = false;
    prep.currentStep = null;
    prep.startedAt = null;
    prep.runId = null;
    if (prep.custodyAccepted) prep.completedSteps = ["collateral", "vesting", "custody"];
    saveState();
    render();
  }
}

async function prepareLenderPrerequisites() {
  ensureDemoPrepState();
  const bundle = sortedRoleBundles("lender")[0] ?? null;
  const blocker = lenderPrereqBlocker(bundle);
  if (blocker) {
    showToast(blocker, "bad");
    return;
  }

  const prep = state.demoUtils.lenderPrep;
  const onboardingRunId = newCapitalRecordId("lender-run");
  const existingCommitmentHash = prep.creditRegistered && !prep.commitmentEscrowed ? prep.commitmentHash : null;
  const existingCommitmentExpiry =
    prep.creditRegistered && !prep.commitmentEscrowed ? Number(prep.commitmentExpiry ?? 0) : 0;
  const canResumeCommitment =
    Boolean(existingCommitmentHash) && existingCommitmentExpiry > Math.floor(Date.now() / 1000) + 60;
  prep.busy = true;
  prep.currentStep = "amount";
  prep.startedAt = Date.now();
  prep.runId = onboardingRunId;
  prep.message = null;
  prep.completedSteps = canResumeCommitment ? ["amount", "commitment"] : ["amount"];
  prep.commitmentHash = canResumeCommitment ? existingCommitmentHash : null;
  prep.commitmentExpiry = canResumeCommitment ? existingCommitmentExpiry : null;
  prep.creditRegistered = canResumeCommitment;
  prep.commitmentEscrowed = false;
  saveState();
  renderDemoUtils();

  try {
    const creditAdapter = contractFor("ERC7984CreditAdapter", contractState.signer);
    const displayAmount = lenderOnboardAmount();
    const amount = creditDisplayToBaseUnits(displayAmount);
    const expiry = Math.floor(Date.now() / 1000) + bundle.expiryDays * ONE_DAY;

    if (canResumeCommitment) {
      const onchainCommitment = await readLenderCreditCommitment(creditAdapter, prep.commitmentHash);
      if (lenderCommitmentReceived(onchainCommitment)) {
        prep.commitmentEscrowed = true;
        completePrepStep("lender", "credit");
        recordLenderCapital({
          commitmentHash: prep.commitmentHash,
          commitmentExpiry: Number(onchainCommitment.expiry),
          amount: displayAmount,
          chainAmount: amount.toString(),
          creditAdapter: await creditAdapter.getAddress(),
          onboardingRunId,
        });
        saveState();
        showToast(`Recovered existing escrowed lender ${CREDIT_TOKEN_LABEL} commitment.`, "good");
        return;
      }
      showToast("Resuming previously registered lender commitment.", "good");
    }

    setPrepStep("lender", "amount", `Checking shielded ${CREDIT_TOKEN_LABEL} readiness.`);
    const shieldedReady = await checkShieldedCreditReadiness({ quiet: true });
    if (!shieldedReady.available) {
      throw new Error(`Shield ${CREDIT_TOKEN_LABEL} before lender escrow, then retry.`);
    }
    completePrepStep("lender", "amount");

    if (!canResumeCommitment) {
      prep.commitmentHash = localAuthorizationCommitment("lender-commitment", `${contractState.account}:${amount}`);
      prep.commitmentExpiry = expiry;
      saveState();

      setPrepStep("lender", "commitment", "Waiting for wallet signature to register lender commitment.");
      const commitmentTx = await withTimeout(
        creditAdapter.registerLenderCreditCommitment(prep.commitmentHash, contractState.account, expiry),
        PREP_WALLET_REQUEST_TIMEOUT_MS,
        "Timed out waiting for the wallet to submit the lender commitment transaction.",
      );
      setPrepStep("lender", "commitment", `Waiting for commitment transaction ${shortHash(commitmentTx.hash)}.`);
      await commitmentTx.wait();
      prep.creditRegistered = true;
      completePrepStep("lender", "commitment");
      prep.commitmentExpiry = expiry;
      saveState();
    }

    setPrepStep("lender", "credit", `Encrypting lender ${CREDIT_TOKEN_LABEL} amount in browser.`);
    const token = confidentialCreditTokenContract(contractState.signer);
    const tokenAddress = await token.getAddress();
    const adapterAddress = await creditAdapter.getAddress();
    const encrypted = await withTimeout(
      encryptedUint64(tokenAddress, contractState.account, amount),
      PREP_ENCRYPTION_TIMEOUT_MS,
      `Timed out encrypting lender ${CREDIT_TOKEN_LABEL}. No escrow transaction was submitted.`,
    );
    const payload = window.ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [prep.commitmentHash]);
    setPrepStep("lender", "credit", `Waiting for wallet signature to escrow shielded ${CREDIT_TOKEN_LABEL}.`);
    const escrowTx = await withTimeout(
      token.confidentialTransferAndCall(adapterAddress, encrypted.handle, encrypted.inputProof, payload),
      PREP_WALLET_REQUEST_TIMEOUT_MS,
      `Timed out waiting for the wallet to submit the ${CREDIT_TOKEN_LABEL} escrow transaction.`,
    );
    setPrepStep("lender", "credit", `Waiting for escrow transaction ${shortHash(escrowTx.hash)}.`);
    await escrowTx.wait();
    prep.commitmentEscrowed = true;
    completePrepStep("lender", "credit");
    recordLenderCapital({
      commitmentHash: prep.commitmentHash,
      commitmentExpiry: expiry,
      amount: displayAmount,
      chainAmount: amount.toString(),
      creditAdapter: await creditAdapter.getAddress(),
      onboardingRunId,
    });
    saveState();
    showToast(`Lender ${CREDIT_TOKEN_LABEL} escrowed. Build and publish an offer from Builder.`, "good");
  } catch (error) {
    showToast(contractError(error, "Lender capital onboarding failed."), "bad");
  } finally {
    prep.busy = false;
    prep.currentStep = null;
    prep.startedAt = null;
    prep.runId = null;
    prep.message = null;
    if (prep.commitmentEscrowed) prep.completedSteps = ["amount", "commitment", "credit"];
    saveState();
    render();
  }
}

async function ensureDemoCollateralPair(options = {}) {
  const prep = state.demoUtils.borrowerPrep;
  const forceNewCollateral = Boolean(options.forceNewCollateral);
  let tokenAddress = forceNewCollateral ? null : (prep.tokenAddress ?? state.demoUtils.latestVestingToken);
  let managerAddress = forceNewCollateral ? null : (prep.managerAddress ?? state.demoUtils.latestVestingManager);

  if (!tokenAddress) {
    setPrepStep("borrower", "collateral", "Deploying demo vesting token.");
    warnDemoUtility(
      "demo-vesting-token",
      "WARNING: DemoVestingToken is a cleartext ERC20-style placeholder, not production TokenOps collateral.",
    );
    const tokenName = currentBorrowerTokenName();
    const tokenSymbol = tokenSymbolFromName(tokenName);
    const token = await demoArtifactFactory("DemoVestingToken").deploy(tokenName, tokenSymbol);
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    state.demoUtils.latestVestingToken = tokenAddress;
    rememberCollateralAsset({
      label: tokenName,
      tokenName,
      tokenSymbol,
      tokenAddress,
      managerAddress: null,
    });
    saveState();
  }

  if (!managerAddress) {
    setPrepStep("borrower", "collateral", "Deploying demo vesting manager.");
    warnDemoUtility(
      "demo-vesting-manager",
      "WARNING: DemoTokenOpsVestingFactory creates cleartext placeholder vesting IDs, not real TokenOps positions.",
    );
    const manager = await demoArtifactFactory("DemoTokenOpsVestingFactory").deploy(tokenAddress);
    await manager.waitForDeployment();
    managerAddress = await manager.getAddress();
    state.demoUtils.latestVestingManager = managerAddress;
    rememberCollateralAsset({
      label: collateralAssetLabel(tokenAddress),
      tokenAddress,
      managerAddress,
    });
    saveState();
  }

  prep.tokenAddress = tokenAddress;
  prep.managerAddress = managerAddress;
  return { tokenAddress, managerAddress };
}

function recordLenderCapital({ commitmentHash, commitmentExpiry, amount, chainAmount, creditAdapter, onboardingRunId }) {
  const existing = (state.demoUtils.lenderCapital ?? []).find(
    (record) => record.commitmentHash && record.commitmentHash.toLowerCase() === commitmentHash.toLowerCase(),
  );
  const record = {
    id: existing?.id ?? newCapitalRecordId("lender"),
    ownerAddress: contractState.account,
    commitmentHash,
    commitmentExpiry,
    amount,
    chainAmount,
    creditAdapter,
    commitmentEscrowed: true,
    usedByBundleId: existing?.usedByBundleId ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
    onboardingRunId,
  };
  if (existing) Object.assign(existing, record);
  else state.demoUtils.lenderCapital.push(record);
  return record;
}

async function readLenderCreditCommitment(creditAdapter, commitmentHash) {
  if (!commitmentHash) return null;
  try {
    const raw = await creditAdapter.getLenderCreditCommitment(commitmentHash);
    return {
      manager: raw.manager ?? raw[0],
      expiry: Number(raw.expiry ?? raw[1] ?? 0),
      amountHandle: bytes32OrZero(raw.amountHandle ?? raw[2]),
      boundAuthorizationHash: bytes32OrZero(raw.boundAuthorizationHash ?? raw[3]),
      registered: Boolean(raw.registered ?? raw[4]),
      received: Boolean(raw.received ?? raw[5]),
      consumed: Boolean(raw.consumed ?? raw[6]),
    };
  } catch (error) {
    console.warn("Unable to read lender credit commitment", error);
    return null;
  }
}

function lenderCommitmentReceived(commitment) {
  return Boolean(
    commitment?.registered &&
    commitment.received &&
    !commitment.consumed &&
    commitment.amountHandle !== window.ethers.ZeroHash,
  );
}

function bytes32OrZero(value) {
  if (value === undefined || value === null) return window.ethers.ZeroHash;
  try {
    return handleToBytes32(value);
  } catch {
    return window.ethers.ZeroHash;
  }
}

function setPrepStep(role, step, message) {
  const prep = role === "lender" ? state.demoUtils.lenderPrep : state.demoUtils.borrowerPrep;
  prep.currentStep = step;
  prep.message = message;
  saveState();
  renderDemoUtils();
  showToast(message, "good");
}

function completePrepStep(role, step) {
  const prep = role === "lender" ? state.demoUtils.lenderPrep : state.demoUtils.borrowerPrep;
  prep.completedSteps = [...new Set([...(prep.completedSteps ?? []), step])];
}

function renderBundleList() {
  const bundles = sortedRoleBundles(state.role);
  const topBundle = bundles[0];
  el.bundleList.innerHTML = "";
  bundles.forEach((bundle) => {
    const selected = bundle.bundleId === state.activeBundleId;
    const card = document.createElement("article");
    card.className = `bundle-card ${selected ? "active" : ""}`;
    card.dataset.bundleId = bundle.bundleId;
    card.innerHTML = `
      <span class="bundle-save-dot ${bundleSaved(bundle) ? "saved" : "unsaved"}" title="${bundleSaved(bundle) ? "Saved" : "Not saved"}"></span>
      <button class="bundle-remove" type="button" data-bundle-action="remove" data-bundle-id="${escapeHtml(bundle.bundleId)}" title="Remove bundle locally" aria-label="Remove ${escapeHtml(bundle.label)} locally">&times;</button>
      <strong>${escapeHtml(bundle.label)}</strong>
      <canvas class="bundle-mini-polygon" width="180" height="112" aria-hidden="true"></canvas>
      <div class="bundle-deltas">
        ${bundleDifferenceLines(bundle, topBundle)
          .map((line) => `<span>${escapeHtml(line)}</span>`)
          .join("")}
      </div>
    `;
    el.bundleList.appendChild(card);
    drawMiniPriorityPolygon(card.querySelector("canvas"), bundle);
  });
}

function renderOrderSaveStatus() {
  if (!el.orderSaveStatus) return;
  const saved = orderSaved(state.role);
  el.orderSaveStatus.textContent = saved ? "Local order saved" : "Local order not saved";
  el.orderSaveStatus.className = `save-status compact ${saved ? "saved" : "unsaved"}`;
}

function syncBundleLabelInput(bundle) {
  el.activeBundleTitle.value = bundle.label;
}

function renderActiveSaveStatus() {
  const bundle = activeBundle();
  if (!el.activeSaveStatus || !bundle) return;
  const saved = bundleSaved(bundle);
  el.activeSaveStatus.textContent = bundle.activated ? "Published" : saved ? "Saved" : "Not published";
  el.activeSaveStatus.className = `save-status ${saved ? "saved" : "unsaved"}`;
}

function renderBuilderCapitalGate(bundle) {
  if (!el.builderCapitalGate || !bundle) return;
  const role = bundle.ownerRole;
  const records = role === "lender" ? availableLenderCapital(bundle) : availableBorrowerCapital(bundle);
  const selected = selectedCapitalRecord(bundle);
  const roleLabel = capitalize(role);
  if (!records.length) {
    el.builderCapitalGate.className = "capital-gate blocked";
    el.builderCapitalGate.innerHTML = `
      <div>
        <strong>${roleLabel} capital required</strong>
        <span>${role === "lender" ? `Escrow ${CREDIT_TOKEN_LABEL} on Demo Utils before publishing lender offers.` : "Move a vesting position into custody on Demo Utils before publishing borrower offers."}</span>
      </div>
      <button type="button" class="ghost" data-builder-jump-demo>Go to Demo Utils</button>
    `;
    return;
  }

  if (!selected || bundle.capitalRecordId !== selected.id) {
    bundle.capitalRecordId = selected.id;
  }

  el.builderCapitalGate.className = "capital-gate";
  el.builderCapitalGate.innerHTML = `
    <label>
      ${roleLabel} capital
      <select data-capital-select>
        ${records
          .map(
            (record) =>
              `<option value="${escapeHtml(record.id)}" ${record.id === selected.id ? "selected" : ""}>${escapeHtml(capitalRecordLabel(record, role))}</option>`,
          )
          .join("")}
      </select>
    </label>
    <div>
      <span>Available cap</span>
      <strong>${escapeHtml(capitalAmountLabel(selected, role))}</strong>
    </div>
  `;
}

function capitalRecordLabel(record, role) {
  if (role === "lender") return `${formatUsd(record.amount)} ${CREDIT_TOKEN_LABEL} escrowed`;
  return `${displayTokenName(record)} | ${formatTokenAmount(record.amount)} tokens | ${shortAddress(record.tokenAddress)} | ${shortAddress(record.managerAddress)}`;
}

function capitalAmountLabel(record, role) {
  if (!record) return "None";
  return role === "lender"
    ? `${formatUsd(record.amount)} ${CREDIT_TOKEN_LABEL}`
    : `${formatTokenAmount(record.amount)} tokens`;
}

function beginFieldRangeDrag(event) {
  const handle = event.target.closest(".range-handle");
  if (!handle) return;
  event.preventDefault();
  const card = handle.closest(".field-card");
  fieldRangeDrag = {
    pointerId: event.pointerId,
    fieldKey: handle.dataset.field,
    prop: handle.dataset.prop,
    card,
  };
  handle.setPointerCapture(event.pointerId);
  updateFieldRangeFromPointer(event);
}

function moveFieldRangeDrag(event) {
  if (!fieldRangeDrag || fieldRangeDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  updateFieldRangeFromPointer(event);
}

function endFieldRangeDrag(event) {
  if (!fieldRangeDrag || fieldRangeDrag.pointerId !== event.pointerId) return;
  const handle = event.target.closest(".range-handle");
  if (handle?.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  fieldRangeDrag = null;
  saveState();
  renderBuilder();
}

function updateFieldRangeFromPointer(event) {
  const bundle = activeBundle();
  if (!bundle || !fieldRangeDrag) return;
  const field = bundle[fieldRangeDrag.fieldKey];
  const editor = fieldRangeDrag.card.querySelector(".range-editor");
  const track = editor.querySelector(".range-track");
  const rect = track.getBoundingClientRect();
  const domain = fieldSliderDomain(fieldRangeDrag.fieldKey, field);
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(rect.width, 1)));
  const nextValue = snapFieldValue(fieldRangeDrag.fieldKey, domain.min + ratio * (domain.max - domain.min));

  if (fieldRangeDrag.prop === "min") {
    field.range.min = Math.min(nextValue, field.range.max);
  } else if (fieldRangeDrag.prop === "max") {
    field.range.max = Math.max(nextValue, field.range.min);
  } else {
    field.range.target = nextValue;
  }

  normalizeField(field);
  updateAutoBundleLabel(bundle);
  touchBundle(bundle);
  refreshFieldRangeCard(fieldRangeDrag.card, fieldRangeDrag.fieldKey, field);
  syncBundleLabelInput(bundle);
  renderImpliedPriceCard();
  renderValuationHelper();
}

function rangeEditor(key, field) {
  const positions = fieldRangePositions(key, field);
  return `
    <div class="range-editor" data-field="${key}">
      <div class="range-track">
        <span class="range-fill" style="left:${positions.min}%; right:${100 - positions.max}%"></span>
        <button class="range-handle range-handle-min" type="button" data-field="${key}" data-prop="min" style="left:${positions.min}%" aria-label="Minimum ${key}"></button>
        <button class="range-handle range-handle-target" type="button" data-field="${key}" data-prop="target" style="left:${positions.target}%" aria-label="Target ${key}"></button>
        <button class="range-handle range-handle-max" type="button" data-field="${key}" data-prop="max" style="left:${positions.max}%" aria-label="Maximum ${key}"></button>
      </div>
    </div>
  `;
}

function refreshFieldRangeCard(card, key, field) {
  card.querySelector(".field-range").textContent = `${fieldValueText(key, field.range.min)} - ${fieldValueText(
    key,
    field.range.max,
  )}`;
  ["min", "target", "max"].forEach((prop) => {
    const input = card.querySelector(`input[type="number"][data-field="${key}"][data-prop="${prop}"]`);
    if (input) input.value = String(field.range[prop]);
  });
  const positions = fieldRangePositions(key, field);
  const fill = card.querySelector(".range-fill");
  if (fill) {
    fill.style.left = `${positions.min}%`;
    fill.style.right = `${100 - positions.max}%`;
  }
  ["min", "target", "max"].forEach((prop) => {
    const handle = card.querySelector(`.range-handle[data-prop="${prop}"]`);
    if (handle) handle.style.left = `${positions[prop]}%`;
  });
}

function fieldRangePositions(key, field) {
  const domain = fieldSliderDomain(key, field);
  return {
    min: fieldValuePosition(field.range.min, domain),
    target: fieldValuePosition(field.range.target, domain),
    max: fieldValuePosition(field.range.max, domain),
  };
}

function fieldValuePosition(value, domain) {
  return ((value - domain.min) / Math.max(domain.max - domain.min, 1)) * 100;
}

function fieldSliderDomain(key, field) {
  const fallback = FIELD_SLIDER_BOUNDS[key] ?? [0, Math.max(field.range.max * 2, 1)];
  const capitalCap = selectedCapitalCapForField(key);
  const fallbackMax = Math.max(fallback[1], field.range.max);
  return {
    min: Math.min(fallback[0], field.range.min),
    max: capitalCap ? Math.max(1, Math.min(fallbackMax, capitalCap)) : fallbackMax,
  };
}

function selectedCapitalCapForField(key, bundle = activeBundle()) {
  if (!bundle) return null;
  const record = selectedCapitalRecord(bundle);
  if (!record) return null;
  if (bundle.ownerRole === "lender" && key === "principal") return Number(record.amount);
  if (bundle.ownerRole === "borrower" && key === "collateralAmount") return Number(record.amount);
  return null;
}

function snapFieldValue(key, value) {
  const step = {
    collateralAmount: 1,
    principal: 10,
    interestBps: 0.1,
    durationDays: 1,
    gracePeriodDays: 1,
  }[key];
  return Math.round(value / step) * step;
}

function finishBundlePointerDrag(event) {
  if (!bundleDrag || bundleDrag.pointerId !== event.pointerId) return;
  const source = el.bundleList.querySelector(`[data-bundle-id="${bundleDrag.bundleId}"]`);
  if (source?.hasPointerCapture(event.pointerId)) source.releasePointerCapture(event.pointerId);

  if (bundleDrag.active) {
    suppressBundleClick = true;
    const targetIndex = bundlePlaceholderIndex();
    cleanupBundleDragVisuals();
    reorderBundleToIndex(bundleDrag.bundleId, targetIndex);
    touchOrder(state.role);
    saveState();
    render();
  }
  bundleDrag = null;
}

function startBundleDragVisuals(event) {
  const source = el.bundleList.querySelector(`[data-bundle-id="${bundleDrag.bundleId}"]`);
  if (!source) return;
  const rect = source.getBoundingClientRect();
  bundleDrag.active = true;
  bundleDrag.ghost = source.cloneNode(true);
  bundleDrag.ghost.classList.add("drag-ghost");
  bundleDrag.ghost.style.width = `${rect.width}px`;
  bundleDrag.ghost.style.left = `${event.clientX - bundleDrag.offsetX}px`;
  bundleDrag.ghost.style.top = `${event.clientY - bundleDrag.offsetY}px`;
  document.body.appendChild(bundleDrag.ghost);

  bundleDrag.placeholder = document.createElement("div");
  bundleDrag.placeholder.className = "bundle-drop-placeholder";
  bundleDrag.placeholder.style.height = `${rect.height}px`;
  source.after(bundleDrag.placeholder);
  source.classList.add("dragging");
}

function moveBundleGhost(event) {
  if (!bundleDrag?.ghost) return;
  bundleDrag.ghost.style.left = `${event.clientX - bundleDrag.offsetX}px`;
  bundleDrag.ghost.style.top = `${event.clientY - bundleDrag.offsetY}px`;
}

function updateBundlePlaceholder(clientY) {
  if (!bundleDrag?.placeholder) return;
  const cards = [...el.bundleList.querySelectorAll(".bundle-card:not(.dragging)")];
  const beforeCard = cards.find((card) => {
    const rect = card.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  if (beforeCard) el.bundleList.insertBefore(bundleDrag.placeholder, beforeCard);
  else el.bundleList.appendChild(bundleDrag.placeholder);
}

function bundlePlaceholderIndex() {
  if (!bundleDrag?.placeholder) return null;
  return [...el.bundleList.children]
    .filter((child) => child.classList.contains("bundle-card") || child.classList.contains("bundle-drop-placeholder"))
    .indexOf(bundleDrag.placeholder);
}

function cleanupBundleDragVisuals() {
  bundleDrag?.ghost?.remove();
  bundleDrag?.placeholder?.remove();
  el.bundleList.querySelectorAll(".bundle-card.dragging").forEach((card) => card.classList.remove("dragging"));
}

function renderFieldControls(bundle) {
  const fields = [
    ["collateralAmount", "Collateral", "vested tokens", 1, "Less", "More"],
    ["principal", "Principal", CREDIT_TOKEN_LABEL, 10, "Less", "More"],
    ["interestBps", "Interest Rate", "% APR", 0.1, "Lower", "Higher"],
    ["durationDays", "Duration", "days", 1, "Shorter", "Longer"],
    ["gracePeriodDays", "Grace Period", "days", 1, "Shorter", "Longer"],
  ];

  el.fieldControls.innerHTML = "";
  fields.forEach(([key, label, unit, step, lowLabel, highLabel], index) => {
    const field = bundle[key];
    const card = document.createElement("article");
    card.className = "field-card";
    card.innerHTML = `
      <div class="field-head">
        <h4>${label}</h4>
        <span>${escapeHtml(unit)}</span>
      </div>
      <strong class="field-range">${fieldValueText(key, field.range.min)} - ${fieldValueText(key, field.range.max)}</strong>
      ${rangeEditor(key, field)}
      <div class="range-labels"><span>${lowLabel}</span><span>${highLabel}</span></div>
      <div class="triple">
        <label>Min<input data-field="${key}" data-prop="min" type="number" step="${step}" value="${field.range.min}" /></label>
        <label>Target<input data-field="${key}" data-prop="target" type="number" step="${step}" value="${field.range.target}" /></label>
        <label>Max<input data-field="${key}" data-prop="max" type="number" step="${step}" value="${field.range.max}" /></label>
      </div>
      <div class="form-row">
        <div class="direction-control" aria-label="${label} preference direction">
          <span>Preference</span>
          <div class="direction-options" role="group">
            ${directionButtons(key, field.direction)}
          </div>
        </div>
      </div>
    `;
    el.fieldControls.appendChild(card);
    if (index === 1) {
      el.fieldControls.appendChild(impliedPriceCard(bundle));
    }
  });
}

function impliedPriceCard(bundle) {
  const price = impliedPricePreference(bundle);
  const card = document.createElement("article");
  card.className = "field-card implied-price-card";
  card.innerHTML = `
    <div class="field-head">
      <h4>Implied Price</h4>
      <span>${CREDIT_TOKEN_LABEL}/token</span>
    </div>
    <strong class="field-range" data-implied="range">${formatTokenPrice(price.range.min)} - ${formatTokenPrice(price.range.max)}</strong>
    <div class="implied-price-display">
      <span>Target</span>
      <strong data-implied="target">${formatTokenPrice(price.range.target)}</strong>
    </div>
    <div class="range-labels"><span>Principal ÷ collateral</span><span>Display only</span></div>
  `;
  return card;
}

function renderImpliedPriceCard() {
  const bundle = activeBundle();
  const card = el.fieldControls.querySelector(".implied-price-card");
  if (!bundle || !card) return;
  const price = impliedPricePreference(bundle);
  card.querySelector('[data-implied="range"]').textContent =
    `${formatTokenPrice(price.range.min)} - ${formatTokenPrice(price.range.max)}`;
  card.querySelector('[data-implied="target"]').textContent = formatTokenPrice(price.range.target);
}

function renderValuationHelper() {
  if (!el.collateralTokenAmount || !el.impliedTokenPrice || !el.collateralValue) return;
  const bundle = activeBundle();
  const principalMax = bundle?.principal.range.max ?? 0;
  const tokenAmount = Number(el.collateralTokenAmount.value || 0);
  const tokenPrice = Number(el.impliedTokenPrice.value || 0);
  const collateralValue = tokenAmount * tokenPrice;
  const ltv = collateralValue > 0 ? (principalMax / collateralValue) * 100 : 0;

  el.collateralValue.textContent = formatUsd(collateralValue);
  el.principalPreview.textContent = `${formatUsd(principalMax)} ${CREDIT_TOKEN_LABEL}`;
  el.ltvPreview.textContent = `${ltv.toFixed(1)}%`;
  el.ltvPreview.style.color = ltv > 80 ? "var(--bad)" : ltv > 65 ? "var(--accent-2)" : "var(--good)";
}

function renderLoans() {
  renderMetrics();
  renderExecutionPanel();
  renderLoanList();
  renderLoanDetail();
}

function renderExecutionPanel() {
  if (!el.executionBundle || !el.executionBucket) return;
  const role = state.role;
  const opposite = oppositeRole(role);
  const roleLabel = capitalize(role);
  const oppositeLabel = opposite === "borrower" ? "borrower demand" : "lender supply";
  const ownBundles = sortedRoleBundles(role);

  el.loanRoleTitle.textContent = `${roleLabel} execution surface`;
  el.loanRoleCopy.textContent =
    role === "borrower"
      ? "Select one of your borrower bundles and a live lender supply bucket. Execution uses public bucket metadata and keeps exact terms encrypted."
      : "Select one of your lender bundles and a live borrower demand bucket. Execution uses public bucket metadata and keeps exact terms encrypted.";
  el.executionPanelTitle.textContent = `Execute ${roleLabel} Bundle`;
  el.executionPanelCopy.textContent = `Choose one of your ${role} bundles and an opposite-side ${oppositeLabel} bucket.`;

  const selectedBundle = el.executionBundle.value;
  const selectedBucket = el.executionBucket.value;
  el.executionBundle.innerHTML = "";
  ownBundles.forEach((bundle) => {
    const option = document.createElement("option");
    option.value = bundle.bundleId;
    option.textContent = `${bundle.label} • ${executionMarketLabel(bundle)} • rank ${bundle.rank}`;
    el.executionBundle.appendChild(option);
  });
  if (selectedBundle && ownBundles.some((bundle) => bundle.bundleId === selectedBundle)) {
    el.executionBundle.value = selectedBundle;
  }

  const activeExecutionBundle = ownBundles.find((bundle) => bundle.bundleId === el.executionBundle.value) ?? null;
  const targetBuckets = executableTargetBuckets(opposite, activeExecutionBundle);

  el.executionBucket.innerHTML = "";
  targetBuckets.forEach((bucket) => {
    const option = document.createElement("option");
    option.value = bucket.id;
    option.textContent = executionMarketLabel(bucket);
    el.executionBucket.appendChild(option);
  });
  if (selectedBucket && targetBuckets.some((bucket) => bucket.id === selectedBucket)) {
    el.executionBucket.value = selectedBucket;
  }

  renderExecutionSummary();
}

function renderExecutionSummary() {
  const ownBundles = sortedRoleBundles(state.role);
  const opposite = oppositeRole(state.role);
  const selectedBundle = ownBundles.find((bundle) => bundle.bundleId === el.executionBundle?.value);
  const targetBuckets = executableTargetBuckets(opposite, selectedBundle);
  const selectedBucket = targetBuckets.find((bucket) => bucket.id === el.executionBucket?.value);
  const blockers = executionBlockers(selectedBundle, selectedBucket);
  const ready = blockers.length === 0;

  const statusLabel = contractState.executionBusy
    ? (contractState.executionNotice?.title ?? "Running")
    : ready
      ? "Ready"
      : "Blocked";
  el.executeBundle.disabled = !ready || contractState.executionBusy;
  el.executionStatus.textContent = statusLabel;
  el.executionStatus.classList.toggle("saved", ready && !contractState.executionBusy);
  el.executionStatus.classList.toggle("unsaved", !ready || contractState.executionBusy);
  el.executionSummary.innerHTML = `
    <div><span>Acting as</span><strong>${capitalize(state.role)}</strong></div>
    <div><span>Your bundle</span><strong>${selectedBundle ? escapeHtml(selectedBundle.label) : "None"}</strong></div>
    <div><span>Your market</span><strong>${selectedBundle ? escapeHtml(executionMarketLabel(selectedBundle)) : "None"}</strong></div>
    <div><span>Target side</span><strong>${opposite === "borrower" ? "Borrower demand" : "Lender supply"}</strong></div>
    <div><span>Target bucket</span><strong>${selectedBucket ? escapeHtml(executionMarketLabel(selectedBucket)) : "None"}</strong></div>
    <div><span>Candidates</span><strong>${selectedBucket?.candidateIds?.length ?? 0}</strong></div>
    <div><span>Discovery</span><strong>${escapeHtml(contractState.discovery?.status ?? "Not synced")}</strong></div>
    <div class="wide"><span>${ready ? "Execution path" : "Current blocker"}</span><strong>${escapeHtml(ready ? "Post bond, execute encrypted match, finalize aggregate feasibility, and settle successful match into escrow." : blockers[0])}</strong></div>
    ${
      contractState.executionNotice
        ? `<div class="wide execution-notice ${escapeHtml(contractState.executionNotice.tone)}"><span>${escapeHtml(contractState.executionNotice.title)}</span><strong>${escapeHtml(contractState.executionNotice.message)}</strong></div>`
        : ""
    }
  `;
}

function setExecutionNotice(title, message, tone = "running") {
  contractState.executionNotice = {
    title,
    message,
    tone,
    updatedAt: Date.now(),
  };
}

function renderLoanList() {
  const loans = displayLoans();
  el.loanList.innerHTML = "";
  if (loans.length === 0) {
    el.loanList.innerHTML = '<div class="empty-state">No Sepolia escrows found in the current discovery window.</div>';
    return;
  }

  loans.forEach((loan) => {
    const selected = loan.loanId === state.activeLoanId;
    const item = document.createElement("article");
    item.className = `loan ${selected ? "active" : ""}`;
    item.dataset.loanId = loan.loanId;
    item.innerHTML = `
      <div class="loan-head">
        <div>
          <span class="badge ${loan.statusClass}">${escapeHtml(loan.status)}</span>
          <h3>${escapeHtml(loan.loanId)} • ${escapeHtml(loan.termsHash)}</h3>
        </div>
        <button type="button" class="ghost" data-action="select">Select</button>
      </div>
      <div class="loan-meta">
        <div><span>Source</span><strong>${escapeHtml(loan.sourceLabel ?? "Browser cache")}</strong></div>
        <div><span>Principal</span><strong>${loanPrincipalLabel(loan)}</strong></div>
        <div><span>Token price</span><strong>${loanTokenPriceLabel(loan)}</strong></div>
        <div><span>Total due</span><strong>${loanTotalDueLabel(loan)}</strong></div>
        <div><span>Funding</span><strong>${loan.fundingCredited ? "Credited" : "Pending"}</strong></div>
        <div><span>Repayment</span><strong>${loan.repaymentCredited ? "Credited" : "Pending"}</strong></div>
      </div>
    `;
    el.loanList.appendChild(item);
  });
}

function renderLoanDetail() {
  const loan = selectedLoan();
  if (!loan) {
    el.loanDetail.className = "empty-state";
    el.loanDetail.innerHTML = "Create or select a loan escrow.";
    return;
  }

  el.loanDetail.className = "loan-detail";
  el.loanDetail.innerHTML = `
    <div class="timeline">
      ${stepPill("Collateral", loan.collateralRegistered)}
      ${stepPill("Funding", loan.fundingCredited)}
      ${stepPill("Active", loan.status === "Active" || isClosedLoan(loan))}
      ${stepPill("Closed", isClosedLoan(loan))}
    </div>
    <dl>
      <div><dt>Escrow</dt><dd>${escapeHtml(loan.loanId)}</dd></div>
      ${loan.escrowAddress ? `<div><dt>Contract escrow</dt><dd>${shortAddress(loan.escrowAddress)}</dd></div>` : ""}
      <div><dt>Borrower label</dt><dd>${escapeHtml(loan.borrowerLabel)}</dd></div>
      <div><dt>Lender label</dt><dd>${escapeHtml(loan.lenderLabel)}</dd></div>
      <div><dt>Execution</dt><dd>${escapeHtml(loanExecutionLabel(loan))}</dd></div>
      <div><dt>Caller model</dt><dd>Public / relayer-compatible</dd></div>
      <div><dt>Terms hash</dt><dd>${escapeHtml(loan.termsHash)}</dd></div>
      <div><dt>Economic terms</dt><dd>${escapeHtml(loanEconomicTermsLabel(loan))}</dd></div>
      <div><dt>Due window</dt><dd>${escapeHtml(loanDueWindowLabel(loan))}</dd></div>
    </dl>
    <div class="loan-actions">
      ${loanActionButton(loan, "register-collateral", "Register Collateral")}
      ${loanActionButton(loan, "fund", "Credit Funding")}
      ${loanActionButton(loan, "activate", "Activate")}
      ${loanActionButton(loan, "repay", "Repay In Full")}
      ${loanActionButton(loan, "check-default", "Check Default")}
      ${loanActionButton(loan, "unwind", "Unwind")}
      ${loanActionButton(loan, "complete-release", "Complete Release")}
    </div>
    ${loanActionNoticeMarkup()}
    <div class="event-log">
      ${loan.events.map((event) => `<div><span>${escapeHtml(event.time)}</span>${escapeHtml(event.text)}</div>`).join("")}
    </div>
  `;
}

async function handleLoanDetailActionClick(event) {
  const button = event.target.closest("#loan-detail button[data-action]");
  if (!button || button.disabled || !state.activeLoanId) return;
  event.preventDefault();
  event.stopPropagation();
  await applyLoanAction(state.activeLoanId, button.dataset.action);
  saveState();
  renderLoans();
}

function selectedLoan() {
  const loans = displayLoans();
  if (!state.activeLoanId && loans.length > 0) state.activeLoanId = loans[0].loanId;
  return loans.find((loan) => loan.loanId === state.activeLoanId);
}

function loanPrincipalLabel(loan) {
  return hasLocalLoanTerms(loan) ? formatUsd(loan.terms.principal) : "Encrypted";
}

function loanTokenPriceLabel(loan) {
  return hasLocalLoanTerms(loan) ? formatTokenPrice(loan.terms.collateralTokenPrice ?? 0) : "Implied privately";
}

function loanTotalDueLabel(loan) {
  return loan.totalDue != null ? formatUsd(loan.totalDue) : "Encrypted";
}

function loanEconomicTermsLabel(loan) {
  if (hasLocalLoanTerms(loan)) return loan.contractBacked ? "Browser-local terms cache" : "Browser-local simulation";
  return "Encrypted; not reconstructable from public chain data";
}

function loanDueWindowLabel(loan) {
  if (loan.dueTimestamp) {
    const due = new Date(Number(loan.dueTimestamp) * 1000).toISOString().slice(0, 10);
    const graceDays = Math.round(Number(loan.gracePeriodSeconds ?? 0) / ONE_DAY);
    return `${due} + ${graceDays}d grace`;
  }
  if (loan.dueDays != null && loan.terms?.grace != null) return `${loan.dueDays}d + ${loan.terms.grace}d grace`;
  return "Unavailable";
}

function hasLocalLoanTerms(loan) {
  return Number.isFinite(Number(loan?.terms?.principal));
}

async function applyLoanAction(loanId, action) {
  const displayLoan = displayLoans().find((item) => item.loanId === loanId);
  if (action !== "select") {
    setLoanActionNotice("Started", `${loanActionLabel(action)} clicked. Preparing the protocol action.`, "running");
    showToast(`Loan action started: ${loanActionLabel(action)}.`, "good", 8_000);
    console.info("[CVC]", APP_BUILD_ID, "loan action click", {
      action,
      loanId,
      activeLoanId: state.activeLoanId,
      account: contractState.account,
      chainId: contractState.chainId,
      displayLoan,
    });
  }
  let loan = state.loans.find((item) => item.loanId === loanId);
  if (loan && displayLoan && action !== "select") {
    Object.assign(loan, structuredClone(displayLoan));
    console.info("[CVC]", APP_BUILD_ID, "loan action hydrated from display state", {
      action,
      loanId,
      status: loan.status,
      collateralRegistered: loan.collateralRegistered,
      fundingCredited: loan.fundingCredited,
      realSettlement: loan.realSettlement,
    });
  }
  if (!loan && action !== "select") {
    if (displayLoan) {
      loan = structuredClone(displayLoan);
      state.loans.unshift(loan);
    }
  }
  if (!loan) {
    setLoanActionNotice("Action Blocked", "Could not find the selected escrow in browser or indexed state.", "bad");
    return;
  }

  if (action === "select") return;
  if (loan.contractBacked) {
    await applyContractLoanAction(loan, action);
    return;
  }
  if (action === "register-collateral") {
    if (loan.status !== "AwaitingEscrow" || loan.collateralRegistered) return;
    loan.collateralRegistered = true;
    loan.events.unshift(eventLine("Relayer called registerVestingCollateral; TokenOps pledge registered"));
  }
  if (action === "fund") {
    if (loan.status !== "AwaitingEscrow" || loan.fundingCredited) return;
    loan.funded = loan.terms.principal;
    loan.fundingCredited = true;
    loan.events.unshift(eventLine("Relayer called escrowFunding with replay-protected funding authorization"));
  }
  if (action === "activate") {
    if (loan.status !== "AwaitingEscrow" || !loan.collateralRegistered || !loan.fundingCredited) return;
    loan.status = "Active";
    loan.statusClass = "";
    loan.events.unshift(eventLine("Relayer called activate; collateral and funding checks passed"));
  }
  if (action === "repay") {
    if (loan.status !== "Active") return;
    loan.paid = loan.totalDue;
    loan.repaymentCredited = true;
    loan.status = "Repaid";
    loan.statusClass = "borrower";
    loan.events.unshift(eventLine("Relayer called makeLoanPayment; vesting returned to borrower"));
  }
  if (action === "check-default") {
    if (loan.status !== "Active") return;
    if (!loan.defaultWindowOpen) {
      loan.defaultWindowOpen = true;
      loan.events.unshift(eventLine("checkDefault returned false; no failure reason exposed"));
      showToast("Default window opened for the next check.", "good");
      return;
    }
    loan.status = "Defaulted";
    loan.statusClass = "lender";
    loan.events.unshift(eventLine("checkDefault returned true; vesting released to lender"));
  }
  if (action === "unwind") {
    if (loan.status !== "AwaitingEscrow") return;
    if (!loan.activationDeadlinePassed) {
      loan.activationDeadlinePassed = true;
      loan.events.unshift(eventLine("Activation deadline marked as passed for simulation"));
      showToast("Activation deadline passed. Click unwind again.", "good");
      return;
    }
    loan.status = "Unwound";
    loan.statusClass = "borrower";
    loan.events.unshift(eventLine("unwindFailedActivation returned collateral to borrower"));
  }
}

async function executeSelectedLiveMatch() {
  const ownBundles = sortedRoleBundles(state.role);
  const selectedBundle = ownBundles.find((bundle) => bundle.bundleId === el.executionBundle?.value);
  const selectedBucket = executableTargetBuckets(oppositeRole(state.role), selectedBundle).find(
    (bucket) => bucket.id === el.executionBucket?.value,
  );
  const blockers = executionBlockers(selectedBundle, selectedBucket);
  if (blockers.length > 0) {
    setExecutionNotice("Blocked", blockers[0], "bad");
    showToast(blockers[0], "bad");
    renderExecutionSummary();
    return;
  }

  contractState.executionBusy = true;
  setExecutionNotice("Preflight", "Checking market compatibility and match bond before opening wallet.", "running");
  renderExecutionSummary();
  const progress = (title, message = title) => {
    setExecutionNotice(title, message, "running");
    showToast(title, "good");
    renderExecutionSummary();
  };

  try {
    const preferenceBook = contractFor("ConfidentialPreferenceBook", contractState.signer);
    const bondManager = contractFor("BondManager", contractState.signer);
    const engine = contractFor("NashNegotiationEngine", contractState.signer);
    const coordinator = contractFor("MatchSettlementCoordinator", contractState.signer);
    const candidateIds = selectedBucket.candidateIds.filter((id) => id !== selectedBundle.contractPreferenceId);
    if (candidateIds.length === 0) throw new Error("Selected bucket only contains the selected taker bundle.");

    const requiredBond = await bondManager.quoteBond(candidateIds.length, selectedBucket.count);
    await preflightMatchExecution({
      bondManager,
      engine,
      selectedBundle,
      selectedBucket,
      candidateIds,
      requiredBond,
    });

    progress("Posting bond", `Opening wallet for ${formatEth(requiredBond)} Sepolia ETH match bond.`);
    const takerAccountId = BigInt(Date.now());
    const bondAttemptId = await bondManager.postBond.staticCall(
      takerAccountId,
      candidateIds.length,
      selectedBucket.count,
      {
        value: requiredBond,
      },
    );
    await (
      await bondManager.postBond(takerAccountId, candidateIds.length, selectedBucket.count, { value: requiredBond })
    ).wait();

    progress("Executing match", "Opening wallet to start the encrypted matcher against the selected bucket.");
    const matchAttemptId = await engine.executeMatch.staticCall(selectedBundle.contractPreferenceId, candidateIds);
    await (await engine.executeMatch(selectedBundle.contractPreferenceId, candidateIds)).wait();

    for (let fieldIndex = 0; fieldIndex < EXECUTION_TERM_FIELD_COUNT; fieldIndex++) {
      progress(
        `Computing term ${fieldIndex + 1}/${EXECUTION_TERM_FIELD_COUNT}`,
        "Opening wallet for an encrypted term computation transaction.",
      );
      await (await engine.computeSelectedTerm(matchAttemptId, fieldIndex)).wait();
    }

    progress("Committing terms", "Opening wallet to commit encrypted selected terms.");
    await (await engine.commitEncryptedTerms(matchAttemptId)).wait();

    progress(
      "Decrypting",
      "Decrypting aggregate feasibility with Zama relayer cryptography. This can take a minute; keep this tab open.",
    );
    const encryptedTerms = await engine.getEncryptedTerms(matchAttemptId);
    const feasibility = await publicDecryptBoolean(handleToBytes32(encryptedTerms.feasible));
    await (
      await engine.finalizeMatchFeasibility(matchAttemptId, feasibility.value, feasibility.decryptionProof)
    ).wait();
    const attempt = await engine.getAttempt(matchAttemptId);

    if (!feasibility.value) {
      await settleFailedMatchIfPossible(coordinator, bondAttemptId, matchAttemptId, selectedBucket);
      selectedBundle.contractExecution = {
        status: "failed",
        message: "Aggregate feasibility finalized false",
        ids: { bondAttemptId, matchAttemptId },
      };
      saveState();
      showToast("Match finalized infeasible.", "bad");
      return;
    }

    progress("Settling match", "Opening wallet to settle the successful match into a loan escrow.");
    const settlement = await settleSuccessfulBrowserMatch({
      preferenceBook,
      coordinator,
      bondAttemptId,
      matchAttemptId,
      attempt,
      selectedBundle,
    });

    const loan = loanFromSettlement({
      selectedBundle,
      selectedBucket,
      matchAttemptId,
      bondAttemptId,
      attempt,
      settlement,
    });
    state.loans.unshift(loan);
    state.activeLoanId = loan.loanId;
    selectedBundle.contractExecution = {
      status: "settled",
      message: "Successful match settled into escrow",
      ids: { bondAttemptId, matchAttemptId, loanId: loan.loanId, escrowAddress: loan.escrowAddress },
    };
    await refreshPublicBookDiscovery({ quiet: true });
    saveState();
    render();
    setExecutionNotice("Settled", "Match settled into escrow.", "good");
    showToast("Match settled into escrow.", "good");
  } catch (error) {
    const message = contractError(error, "Live match execution failed.");
    setExecutionNotice("Execution failed", message, "bad");
    showToast(message, "bad");
  } finally {
    contractState.executionBusy = false;
    renderExecutionSummary();
  }
}

async function preflightMatchExecution({
  bondManager,
  engine,
  selectedBundle,
  selectedBucket,
  candidateIds,
  requiredBond,
}) {
  const balance = await contractState.provider.getBalance(contractState.account);
  if (balance < requiredBond) {
    throw new Error(
      `Match bond requires ${formatEth(requiredBond)} Sepolia ETH; connected wallet has ${formatEth(balance)}.`,
    );
  }
  await engine.executeMatch.staticCall(selectedBundle.contractPreferenceId, candidateIds);
  await bondManager.postBond.staticCall(BigInt(Date.now()), candidateIds.length, selectedBucket.count, {
    value: requiredBond,
  });
}

async function settleSuccessfulBrowserMatch({
  preferenceBook,
  coordinator,
  bondAttemptId,
  matchAttemptId,
  attempt,
  selectedBundle,
}) {
  const takerPreference = await preferenceBook.getPreferenceBundle(attempt.takerPreferenceId);
  const makerPreference = await preferenceBook.getPreferenceBundle(attempt.makerPreferenceId);
  const borrowerPreference = Number(takerPreference.metadata.side) === 0 ? takerPreference : makerPreference;
  const lenderPreference = Number(takerPreference.metadata.side) === 1 ? takerPreference : makerPreference;
  const borrowerEvidence = await preferenceBook.getBorrowerBackingEvidence(borrowerPreference.backingId);
  const lenderEvidence = await preferenceBook.getLenderBackingEvidence(lenderPreference.backingId);
  if (!borrowerEvidence.registered || !lenderEvidence.registered) {
    throw new Error("Matched preferences do not have registered backing evidence.");
  }

  const now = Math.floor(Date.now() / 1000);
  const fundingAuthorizationHash = localAuthorizationCommitment("funding-draw", matchAttemptId);
  const loanConfig = {
    borrower: borrowerPreference.manager,
    lender: lenderPreference.manager,
    vestingAdapter: borrowerEvidence.vestingAdapter,
    creditAdapter: lenderEvidence.creditAdapter,
    tokenOpsManager: borrowerEvidence.tokenOpsManager,
    vestingId: borrowerEvidence.vestingId,
    dueTimestamp: now + Math.max(1, Math.round(selectedBundle.durationDays.range.target)) * ONE_DAY,
    gracePeriodSeconds: Math.max(0, Math.round(selectedBundle.gracePeriodDays.range.target)) * ONE_DAY,
    activationDeadline: now + ONE_DAY,
    fundingCommitmentHash: lenderEvidence.commitmentHash,
    fundingAuthorizationHash,
    repaymentAuthorizationHash: localAuthorizationCommitment("repayment", matchAttemptId),
    termsHash: attempt.termsHash,
    encryptedTermsHash: attempt.encryptedTermsHash,
  };
  const [loanId, escrowAddress] = await coordinator.settleSuccessfulMatch.staticCall(
    bondAttemptId,
    matchAttemptId,
    loanConfig,
  );
  await (await coordinator.settleSuccessfulMatch(bondAttemptId, matchAttemptId, loanConfig)).wait();
  return { loanId, escrowAddress, loanConfig, borrowerEvidence, lenderEvidence };
}

async function settleFailedMatchIfPossible(coordinator, bondAttemptId, matchAttemptId, selectedBucket) {
  const counterparties = [...new Set((selectedBucket.managers ?? []).filter(Boolean))];
  if (counterparties.length === 0) return;
  await (await coordinator.settleFailedMatch(bondAttemptId, matchAttemptId, counterparties)).wait();
}

function loanFromSettlement({ selectedBundle, selectedBucket, matchAttemptId, bondAttemptId, attempt, settlement }) {
  const localPrincipal = Number(selectedBundle.principal.range.target);
  const localRate = Number(selectedBundle.interestBps.range.target);
  const totalDue = Math.round(localPrincipal * (1 + localRate / 100));
  const role = selectedBundle.ownerRole;
  const borrowerLabel = role === "borrower" ? selectedBundle.label : "Matched borrower";
  const lenderLabel = role === "lender" ? selectedBundle.label : "Matched lender";
  return {
    loanId: String(settlement.loanId),
    escrowAddress: settlement.escrowAddress,
    matchId: matchAttemptId,
    bondAttemptId,
    status: "AwaitingEscrow",
    statusClass: "",
    borrowerLabel,
    lenderLabel,
    borrowerAddress: settlement.loanConfig.borrower,
    lenderAddress: settlement.loanConfig.lender,
    contractBacked: true,
    realSettlement: true,
    collateralRegistered: false,
    fundingCredited: false,
    repaymentCredited: false,
    funded: 0,
    paid: 0,
    termsHash: attempt.termsHash,
    encryptedTermsHash: attempt.encryptedTermsHash,
    terms: {
      principal: localPrincipal,
      collateralTokenPrice: impliedPricePreference(selectedBundle).range.target,
      interest: localRate,
      duration: Number(selectedBundle.durationDays.range.target),
      grace: Number(selectedBundle.gracePeriodDays.range.target),
    },
    principalAmount: creditDisplayToBaseUnits(Math.max(1, Math.round(localPrincipal))).toString(),
    totalDue,
    totalDueAmount: creditDisplayToBaseUnits(Math.max(1, Math.round(totalDue))).toString(),
    dueDays: Number(selectedBundle.durationDays.range.target),
    fundingCommitmentHash: settlement.loanConfig.fundingCommitmentHash,
    fundingAuthorizationHash: settlement.loanConfig.fundingAuthorizationHash,
    repaymentAuthorizationHash: settlement.loanConfig.repaymentAuthorizationHash,
    fundingDeadline: settlement.lenderEvidence.expiry?.toString?.() ?? null,
    vestingId: settlement.loanConfig.vestingId,
    tokenOpsManager: settlement.loanConfig.tokenOpsManager,
    creditAdapter: settlement.loanConfig.creditAdapter,
    creditToken: contractState.manifest?.assets?.confidentialCreditToken ?? null,
    releaseRecipient: null,
    releaseCompleted: false,
    targetBucketId: selectedBucket.id,
    events: [
      eventLine("Successful encrypted match settled into contract escrow"),
      eventLine("ERC-7984 funding and repayment can now be completed from the escrow actions"),
    ],
  };
}

async function applyContractLoanAction(loan, action) {
  if (!loan.realSettlement && !isLocalManifestChain() && MOCK_BACKED_LOAN_ACTIONS.has(action)) {
    showToast("This Sepolia action is disabled because it would route through mock settlement helpers.", "bad");
    return;
  }

  const requiredContracts = loan.realSettlement
    ? ["TokenOpsVestingAdapter", "ERC7984CreditAdapter"]
    : isLocalManifestChain()
      ? ["MockTokenOpsVestingManager", "TokenOpsVestingAdapter", "MockConfidentialCreditAdapter"]
      : ["TokenOpsVestingAdapter"];
  if (!canUseContracts(requiredContracts)) {
    const message = "Connect a wallet on the manifest chain first.";
    setLoanActionNotice("Wallet Not Ready", message, "bad");
    showToast(message, "bad");
    console.warn("[CVC]", APP_BUILD_ID, "contract action blocked: wallet/contracts unavailable", {
      action,
      loan,
      requiredContracts,
      hasWalletProvider: Boolean(activeWalletProvider()),
      hasSigner: Boolean(contractState.signer),
      account: contractState.account,
      chainId: contractState.chainId,
      manifestChainId: contractState.manifest?.chainId,
    });
    return;
  }

  try {
    const escrow = loanEscrowContract(loan, contractState.signer);
    if (action === "register-collateral") {
      if (loan.status !== "AwaitingEscrow" || loan.collateralRegistered) return;
      if (loan.realSettlement) {
        const tx = await escrow.registerVestingCollateral();
        showToast("Collateral registration submitted.", "good");
        await tx.wait();
        loan.collateralRegistered = true;
        loan.pledgeId = await escrow.pledgeId();
        loan.events.unshift(eventLine("Contract registerVestingCollateral succeeded against real TokenOps adapter"));
        return;
      }
      warnLocalPlaceholder(
        "tokenops-seed",
        `${placeholderScope()} PLACEHOLDER: using MockTokenOpsVestingManager to simulate borrower-initiated pending custody transfer into the vesting adapter.`,
      );
      const vestingManager = contractFor("MockTokenOpsVestingManager", contractState.signer);
      const vestingAdapter = contractFor("TokenOpsVestingAdapter", contractState.signer);
      const borrowerAddress = window.ethers.getAddress(loan.borrowerAddress ?? contractState.account);
      const vestingManagerAddress = manifestContractEntry("MockTokenOpsVestingManager").address;
      const vestingAdapterAddress = manifestContractEntry("TokenOpsVestingAdapter").address;
      await (await vestingManager.seedVesting(loan.vestingId, borrowerAddress)).wait();
      await (await vestingManager.initiateVestingTransfer(loan.vestingId, vestingAdapterAddress, 86_400)).wait();
      await (
        await vestingAdapter.acceptPendingVestingTransfer(vestingManagerAddress, loan.vestingId, borrowerAddress)
      ).wait();
      const tx = await escrow.registerVestingCollateral();
      showToast("Collateral registration submitted.", "good");
      await tx.wait();
      loan.collateralRegistered = true;
      loan.pledgeId = await escrow.pledgeId();
      loan.events.unshift(
        eventLine("Contract registerVestingCollateral succeeded through the configured TokenOps adapter"),
      );
    }
    if (action === "fund") {
      if (loan.status !== "AwaitingEscrow" || loan.fundingCredited) return;
      if (loan.realSettlement) {
        setLoanActionNotice("Credit Funding", "Checking Sepolia funding state before opening wallet.", "running");
        showToast("Credit Funding started. Checking on-chain funding state.", "good", 12_000);
        const auth = creditAuth("funding", loan, loan.principalAmount ?? "0");
        await registerAndConsumeRealFunding(escrow, auth, loan);
        loan.funded = creditBaseUnitsToDisplay(loan.principalAmount);
        loan.fundingCredited = true;
        loan.events.unshift(eventLine("ERC-7984 lender commitment bound, finalized, and consumed for escrow funding"));
        return;
      }
      warnLocalPlaceholder(
        "credit-funding",
        `${placeholderScope()} PLACEHOLDER: MockConfidentialCreditAdapter authorizes cleartext credit. Sepolia live-match escrows use ERC-7984 confidential transfer callbacks through ERC7984CreditAdapter.`,
      );
      const auth = creditAuth("funding", loan, loan.principalAmount);
      await registerAndConsumeFunding(escrow, auth, loan);
      loan.funded = creditBaseUnitsToDisplay(loan.principalAmount);
      loan.fundingCredited = true;
      loan.events.unshift(
        eventLine("Contract funding authorization registered and consumed through the configured credit adapter"),
      );
    }
    if (action === "activate") {
      setLoanActionNotice("Activation Preflight", "Reading current escrow state from Sepolia.", "running");
      const snapshot = await readLoanEscrowSnapshot(escrow);
      Object.assign(loan, snapshot.loanPatch);
      console.info("[CVC]", APP_BUILD_ID, "activation preflight", {
        loanId: loan.loanId,
        escrow: loan.escrowAddress,
        account: contractState.account,
        snapshot,
      });
      if (snapshot.state === 2) {
        loan.status = "Active";
        loan.statusClass = "";
        loan.events.unshift(eventLine("Escrow already active on-chain"));
        setLoanActionNotice("Already Active", "This escrow is already active on Sepolia.", "good");
        showToast("Escrow already active.", "good");
        return;
      }
      if (snapshot.state !== 1) {
        throw new Error(`Escrow is ${snapshot.statusLabel}, not AwaitingEscrow.`);
      }
      if (!snapshot.collateralRegistered) throw new Error("Sepolia escrow reports collateral is not registered.");
      if (!snapshot.fundingCredited) throw new Error("Sepolia escrow reports funding is not credited.");
      const gas = await escrow.activate.estimateGas();
      const feeData = await contractState.provider.getFeeData();
      const balance = await contractState.provider.getBalance(contractState.account);
      const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
      const estimatedMaxCost = maxFeePerGas ? gas * maxFeePerGas : 0n;
      if (estimatedMaxCost && balance < estimatedMaxCost) {
        throw new Error(
          `Activation needs up to ${formatEth(estimatedMaxCost)} Sepolia ETH; connected wallet has ${formatEth(balance)}.`,
        );
      }
      setLoanActionNotice(
        "Opening Wallet",
        `MetaMask should open for activate(). Estimated gas ${gas.toString()}.`,
        "running",
      );
      showToast("Opening MetaMask for activation.", "good", 12_000);
      const tx = await withTimeout(
        escrow.activate(),
        60_000,
        "Timed out waiting for MetaMask to return an activation transaction. Check MetaMask activity, unlock state, and pop-up permissions.",
      );
      setLoanActionNotice("Activation Submitted", `Waiting for ${shortHash(tx.hash)} to confirm.`, "running");
      showToast("Activation submitted.", "good");
      await tx.wait();
      loan.status = "Active";
      loan.statusClass = "";
      loan.events.unshift(eventLine("Contract activate succeeded"));
      setLoanActionNotice("Activated", "Loan escrow is active on Sepolia.", "good");
    }
    if (action === "repay") {
      if (loan.status !== "Active") return;
      if (loan.realSettlement) {
        if (!loan.totalDueAmount) throw new Error("Repayment amount is not available from public indexed loan data.");
        const auth = creditAuth("repayment", loan, loan.totalDueAmount);
        await registerAndConsumeRealPayment(escrow, auth, loan);
        loan.paid = creditBaseUnitsToDisplay(loan.totalDueAmount);
        loan.repaymentCredited = true;
        loan.status = "Repaid";
        loan.statusClass = "borrower";
        loan.releaseRecipient = loan.borrowerAddress;
        await completeRealCollateralRelease(loan, loan.borrowerAddress);
        loan.events.unshift(eventLine("ERC-7984 repayment consumed; vesting release initiated to borrower"));
        return;
      }
      warnLocalPlaceholder(
        "credit-repayment",
        `${placeholderScope()} PLACEHOLDER: MockConfidentialCreditAdapter authorizes cleartext repayment credit. Sepolia live-match escrows use encrypted ERC-7984 repayment settlement.`,
      );
      const auth = creditAuth("repayment", loan, loan.totalDueAmount);
      await registerAndConsumePayment(escrow, auth, loan);
      loan.paid = creditBaseUnitsToDisplay(loan.totalDueAmount);
      loan.repaymentCredited = true;
      loan.status = "Repaid";
      loan.statusClass = "borrower";
      await completeLocalCollateralRelease(loan, loan.borrowerAddress ?? contractState.account);
      loan.events.unshift(eventLine("Contract makeLoanPayment succeeded; vesting release initiated to borrower"));
    }
    if (action === "check-default") {
      if (loan.status !== "Active") return;
      if (!isLocalManifestChain()) {
        const willDefault = await escrow.checkDefault.staticCall();
        const tx = await escrow.checkDefault();
        showToast("Default check submitted.", "good");
        await tx.wait();
        loan.defaultWindowOpen = true;
        if (willDefault) {
          loan.status = "Defaulted";
          loan.statusClass = "lender";
          loan.releaseRecipient = loan.lenderAddress;
          if (loan.realSettlement) {
            await completeRealCollateralRelease(loan, loan.lenderAddress);
          }
          loan.events.unshift(eventLine("Contract checkDefault returned true; vesting released to lender"));
        } else {
          loan.events.unshift(eventLine("Contract checkDefault returned false; escrow remains active"));
        }
        return;
      }
      if (!loan.defaultWindowOpen) {
        await contractState.provider.send("evm_increaseTime", [(loan.dueDays + loan.terms.grace + 1) * ONE_DAY]);
        await contractState.provider.send("evm_mine", []);
        loan.defaultWindowOpen = true;
        loan.events.unshift(eventLine("Local Hardhat time advanced past due + grace for default testing"));
        showToast("Default window advanced locally. Click again to check default.", "good");
        return;
      }
      const tx = await escrow.checkDefault();
      showToast("Default check submitted.", "good");
      await tx.wait();
      loan.status = "Defaulted";
      loan.statusClass = "lender";
      await completeLocalCollateralRelease(loan, loan.lenderAddress ?? contractState.account);
      loan.events.unshift(eventLine("Contract checkDefault succeeded; vesting release initiated to lender"));
    }
    if (action === "unwind") {
      if (loan.status !== "AwaitingEscrow") return;
      if (!isLocalManifestChain()) {
        const tx = await escrow.unwindFailedActivation();
        showToast("Unwind submitted.", "good");
        await tx.wait();
        loan.status = "Unwound";
        loan.statusClass = "borrower";
        if (loan.realSettlement && loan.collateralRegistered) {
          loan.releaseRecipient = loan.borrowerAddress;
          await completeRealCollateralRelease(loan, loan.borrowerAddress);
        } else {
          loan.releaseRecipient = null;
          loan.releaseCompleted = true;
        }
        loan.events.unshift(eventLine("Contract unwindFailedActivation succeeded"));
        return;
      }
      if (!loan.activationDeadlinePassed) {
        await contractState.provider.send("evm_increaseTime", [ONE_DAY + 1]);
        await contractState.provider.send("evm_mine", []);
        loan.activationDeadlinePassed = true;
        loan.events.unshift(eventLine("Local Hardhat time advanced past activation deadline"));
        showToast("Activation deadline advanced locally. Click unwind again.", "good");
        return;
      }
      const tx = await escrow.unwindFailedActivation();
      showToast("Unwind submitted.", "good");
      await tx.wait();
      loan.status = "Unwound";
      loan.statusClass = "borrower";
      await completeLocalCollateralRelease(loan, loan.borrowerAddress ?? contractState.account);
      loan.events.unshift(eventLine("Contract unwindFailedActivation succeeded"));
    }
    if (action === "complete-release") {
      if (!loan.realSettlement) return;
      const recipient =
        loan.releaseRecipient ?? (loan.status === "Defaulted" ? loan.lenderAddress : loan.borrowerAddress);
      await completeRealCollateralRelease(loan, recipient);
    }
  } catch (error) {
    const message = contractError(error, "Loan action failed.");
    setLoanActionNotice("Action Failed", message, "bad");
    showToast(message, "bad", 12_000);
  }
}

async function readLoanEscrowSnapshot(escrow) {
  const [stateRaw, pledgeId, fundingCredited, repaymentCredited, activationDeadline, dueTimestamp] = await Promise.all([
    escrow.state(),
    escrow.pledgeId(),
    escrow.fundingCredited(),
    escrow.repaymentCredited(),
    escrow.activationDeadline(),
    escrow.dueTimestamp(),
  ]);
  const stateNumber = Number(stateRaw);
  const collateralRegistered = pledgeId !== window.ethers.ZeroHash;
  return {
    state: stateNumber,
    statusLabel: LOAN_STATE[stateNumber] ?? `state ${stateNumber}`,
    pledgeId,
    collateralRegistered,
    fundingCredited: Boolean(fundingCredited),
    repaymentCredited: Boolean(repaymentCredited),
    activationDeadline: Number(activationDeadline),
    dueTimestamp: Number(dueTimestamp),
    loanPatch: {
      status: LOAN_STATE[stateNumber] ?? `state ${stateNumber}`,
      statusClass: loanStatusClass(LOAN_STATE[stateNumber] ?? ""),
      pledgeId,
      collateralRegistered,
      fundingCredited: Boolean(fundingCredited),
      repaymentCredited: Boolean(repaymentCredited),
      activationDeadline: Number(activationDeadline),
      dueTimestamp: Number(dueTimestamp),
    },
  };
}

async function registerAndConsumeRealFunding(escrow, auth, loan) {
  const creditAdapter = creditAdapterContract(loan, contractState.signer);
  setLoanActionNotice("Credit Funding", "Reading the funding authorization from Sepolia.", "running");
  showToast("Reading funding authorization from Sepolia.", "good", 12_000);
  let authorization = await readCreditAuthorization(creditAdapter, auth.authorizationHash);
  if (!authorization?.received) {
    if (!Number(auth.amount)) {
      throw new Error("Funding amount is not available from browser cache or the on-chain adapter authorization.");
    }
    showToast("Registering funding authorization.", "good");
    await (await escrow.registerFundingAuthorization(auth)).wait();
    authorization = await readCreditAuthorization(creditAdapter, auth.authorizationHash);
  } else {
    setLoanActionNotice("Credit Funding", "Funding authorization found. Resuming from the next step.", "running");
    showToast("Funding authorization found; resuming.", "good", 12_000);
  }

  auth = fundingAuthFromAuthorization(auth, authorization, loan);
  if (authorization?.consumed) {
    loan.fundingCredited = true;
    return;
  }
  if (!authorization?.acceptanceFinalized) {
    await finalizeAdapterAcceptance(creditAdapter, auth.authorizationHash, "Funding");
  } else if (!authorization.accepted) {
    throw new Error("Funding encrypted amount was rejected by the ERC-7984 adapter.");
  }
  setLoanActionNotice("Credit Funding", "Opening wallet to consume the funded credit into escrow.", "running");
  showToast("Consuming escrow funding.", "good");
  await (await escrow.escrowFunding(auth)).wait();
}

async function readCreditAuthorization(creditAdapter, authorizationHash) {
  try {
    return await creditAdapter.getAuthorization(authorizationHash);
  } catch (error) {
    const decoded = decodeKnownContractError(error);
    if (decoded?.startsWith("AuthorizationDoesNotExist")) return null;
    throw error;
  }
}

function fundingAuthFromAuthorization(auth, authorization, loan) {
  if (!authorization?.received) return auth;
  const amount = authorization.expectedAmount?.toString?.() ?? authorization[2]?.toString?.() ?? auth.amount;
  const deadline = Number(authorization.deadline ?? authorization[3] ?? auth.deadline);
  loan.principalAmount = amount;
  loan.fundingDeadline = String(deadline);
  return {
    ...auth,
    amount,
    deadline,
  };
}

function setLoanActionNotice(title, message, tone = "running") {
  contractState.loanActionNotice = {
    title,
    message,
    tone,
    updatedAt: Date.now(),
  };
  renderLoanActionNotice();
}

function loanActionNoticeMarkup() {
  const notice = contractState.loanActionNotice;
  if (!notice) return '<div id="loan-action-notice" class="loan-action-notice" hidden></div>';
  return `
    <div id="loan-action-notice" class="loan-action-notice ${escapeHtml(notice.tone)}">
      <span>${escapeHtml(notice.title)}</span>
      <strong>${escapeHtml(notice.message)}</strong>
    </div>
  `;
}

function renderLoanActionNotice() {
  const target = document.querySelector("#loan-action-notice");
  if (!target) return;
  const notice = contractState.loanActionNotice;
  if (!notice) {
    target.hidden = true;
    target.textContent = "";
    return;
  }
  target.hidden = false;
  target.className = `loan-action-notice ${notice.tone}`;
  target.innerHTML = `<span>${escapeHtml(notice.title)}</span><strong>${escapeHtml(notice.message)}</strong>`;
}

async function registerAndConsumeRealPayment(escrow, auth, loan) {
  if (!equalAddress(contractState.account, loan.borrowerAddress)) {
    throw new Error(`Repayment transfer must be sent by borrower ${shortAddress(loan.borrowerAddress)}.`);
  }
  const creditAdapter = creditAdapterContract(loan, contractState.signer);
  showToast("Registering repayment authorization.", "good");
  await (await escrow.registerPaymentAuthorization(auth)).wait();
  await transferConfidentialCreditAndFinalize({
    creditAdapter,
    authorizationHash: auth.authorizationHash,
    amount: auth.amount,
    payer: loan.borrowerAddress,
    label: "Repayment",
  });
  showToast("Consuming repayment.", "good");
  await (await escrow.makeLoanPayment(auth)).wait();
}

async function transferConfidentialCreditAndFinalize({ creditAdapter, authorizationHash, amount, payer, label }) {
  const token = confidentialCreditTokenContract(contractState.signer);
  const tokenAddress = await token.getAddress();
  const adapterAddress = await creditAdapter.getAddress();
  const encrypted = await encryptedUint64(tokenAddress, payer, amount);
  const payload = window.ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [authorizationHash]);
  showToast(`${label} confidential transfer submitted.`, "good");
  await (
    await token.confidentialTransferAndCall(adapterAddress, encrypted.handle, encrypted.inputProof, payload)
  ).wait();
  await finalizeAdapterAcceptance(creditAdapter, authorizationHash, label);
}

async function finalizeAdapterAcceptance(creditAdapter, authorizationHash, label) {
  const authorization = await creditAdapter.getAuthorization(authorizationHash);
  const acceptanceHandle = handleToBytes32(authorization.acceptanceHandle);
  if (acceptanceHandle === window.ethers.ZeroHash) {
    throw new Error(`${label} acceptance handle is not ready.`);
  }
  setLoanActionNotice(label, "Decrypting adapter acceptance with the Zama relayer. Keep this tab open.", "running");
  showToast(`${label} acceptance decrypting with the Zama relayer; keep this tab open.`, "good", 30_000);
  const acceptance = await publicDecryptBoolean(acceptanceHandle);
  if (!acceptance.value) {
    setLoanActionNotice(
      label,
      "Encrypted amount mismatch. Opening wallet to finalize the rejection and release the lender commitment.",
      "bad",
    );
    showToast(`${label} amount mismatch. Opening wallet to finalize rejection.`, "bad", 12_000);
    await (
      await creditAdapter.finalizeCreditAcceptance(authorizationHash, acceptance.value, acceptance.decryptionProof)
    ).wait();
    throw new Error(
      `${label} encrypted amount was rejected by the ERC-7984 adapter. The lender escrow amount did not equal the loan funding amount.`,
    );
  }
  setLoanActionNotice(label, "Opening wallet to finalize encrypted acceptance on-chain.", "running");
  showToast(`${label} acceptance finalized. Opening wallet for confirmation.`, "good", 12_000);
  await (
    await creditAdapter.finalizeCreditAcceptance(authorizationHash, acceptance.value, acceptance.decryptionProof)
  ).wait();
}

function debugLoanAction(action = "fund") {
  const loan = selectedLoan();
  return {
    appBuildId: APP_BUILD_ID,
    action,
    activeLoanId: state.activeLoanId,
    account: contractState.account,
    chainId: contractState.chainId,
    manifestChainId: contractState.manifest?.chainId,
    walletSource: contractState.walletSource,
    loan: loan
      ? {
          loanId: loan.loanId,
          escrowAddress: loan.escrowAddress,
          status: loan.status,
          contractBacked: loan.contractBacked,
          realSettlement: loan.realSettlement,
          collateralRegistered: loan.collateralRegistered,
          fundingCredited: loan.fundingCredited,
          principalAmount: loan.principalAmount,
          fundingCommitmentHash: loan.fundingCommitmentHash,
          fundingAuthorizationHash: loan.fundingAuthorizationHash,
          fundingDeadline: loan.fundingDeadline,
        }
      : null,
    enabled: loan ? isLoanActionEnabled(loan, action) : false,
    canUseContracts: loan?.realSettlement
      ? canUseContracts(["TokenOpsVestingAdapter", "ERC7984CreditAdapter"])
      : canUseContracts(["TokenOpsVestingAdapter"]),
  };
}

async function completeRealCollateralRelease(loan, recipientAddress) {
  const recipient = window.ethers.getAddress(recipientAddress);
  loan.releaseRecipient = recipient;
  if (!equalAddress(recipient, contractState.account)) {
    loan.events.unshift(eventLine(`Collateral release pending recipient wallet ${shortAddress(recipient)}`));
    return false;
  }

  const pledgeId = loan.pledgeId ?? (await loanEscrowContract(loan, contractState.provider).pledgeId());
  const tokenOpsManager = tokenOpsManagerContract(loan.tokenOpsManager, contractState.signer);
  const vestingAdapter = contractFor("TokenOpsVestingAdapter", contractState.signer);
  showToast("Accepting TokenOps collateral release.", "good");
  await (await tokenOpsManager.acceptVestingTransfer(loan.vestingId)).wait();
  showToast("Completing TokenOps collateral release.", "good");
  await (await vestingAdapter.completeRelease(pledgeId)).wait();
  loan.pledgeId = pledgeId;
  loan.releaseCompleted = true;
  loan.events.unshift(eventLine(`Collateral release completed by ${shortAddress(recipient)}`));
  return true;
}

async function registerAndConsumeFunding(escrow, auth, loan) {
  const creditAdapter = contractFor("MockConfidentialCreditAdapter", contractState.signer);
  await (await escrow.registerFundingAuthorization(auth)).wait();
  await (await creditAdapter.authorizeCredit(auth.authorizationHash, loan.lenderAddress, auth.amount)).wait();
  await (await escrow.escrowFunding(auth)).wait();
}

async function registerAndConsumePayment(escrow, auth, loan) {
  const creditAdapter = contractFor("MockConfidentialCreditAdapter", contractState.signer);
  await (await escrow.registerPaymentAuthorization(auth)).wait();
  await (await creditAdapter.authorizeCredit(auth.authorizationHash, loan.borrowerAddress, auth.amount)).wait();
  await (await escrow.makeLoanPayment(auth)).wait();
}

async function completeLocalCollateralRelease(loan, recipientAddress) {
  if (!isLocalManifestChain()) return false;
  const recipient = window.ethers.getAddress(recipientAddress);
  if (!equalAddress(recipient, contractState.account)) {
    loan.events.unshift(eventLine(`Collateral release pending acceptance by ${shortAddress(recipient)}`));
    return false;
  }

  const escrow = loanEscrowContract(loan, contractState.provider);
  const pledgeId = loan.pledgeId ?? (await escrow.pledgeId());
  const vestingManager = contractFor("MockTokenOpsVestingManager", contractState.signer);
  const vestingAdapter = contractFor("TokenOpsVestingAdapter", contractState.signer);
  await (await vestingManager.acceptVestingTransfer(loan.vestingId)).wait();
  await (await vestingAdapter.completeRelease(pledgeId)).wait();
  loan.pledgeId = pledgeId;
  loan.events.unshift(eventLine(`Collateral release completed by ${shortAddress(recipient)}`));
  return true;
}

function loanExecutionLabel(loan) {
  if (!loan.contractBacked) return "Browser-local legacy simulation";
  if (!contractState.manifest) return "Contract escrow";
  return isLocalManifestChain()
    ? "Local contract escrow"
    : `${contractState.manifest.network ?? "Public"} contract escrow`;
}

function isLocalManifestChain() {
  const chainId = Number(contractState.manifest?.chainId ?? contractState.chainId ?? 0);
  const network = String(contractState.manifest?.network ?? "").toLowerCase();
  return chainId === 31337 || network === "hardhat" || network === "localhost" || network === "anvil";
}

function placeholderScope() {
  return isLocalManifestChain() ? "LOCAL" : "TESTNET";
}

function creditAuth(kind, loan, amount) {
  const deadline =
    kind === "funding" && loan.fundingDeadline ? Number(loan.fundingDeadline) : Math.floor(Date.now() / 1000) + ONE_DAY;
  return {
    amount,
    deadline,
    authorizationHash:
      kind === "funding"
        ? loan.fundingAuthorizationHash
        : kind === "repayment"
          ? loan.repaymentAuthorizationHash
          : null,
  };
}

function localAuthorizationCommitment(kind, matchId) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return window.ethers.keccak256(
    window.ethers.concat([window.ethers.toUtf8Bytes(`${kind}:${matchId}:${Date.now()}:`), bytes]),
  );
}

async function loadDeploymentManifest() {
  try {
    const response = await fetch("./deployment-manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
    const manifest = await response.json();
    validateManifest(manifest);
    contractState.manifest = manifest;
    contractState.readProvider = null;
    contractState.relayerInstance = null;
    contractState.relayerConfigKey = null;
    contractState.discovery = liveDiscoveryDefaults();
    showToast("Deployment manifest loaded.", "good");
    void refreshPublicBookDiscovery({ quiet: true });
  } catch {
    contractState.manifest = null;
    contractState.readProvider = null;
    contractState.relayerInstance = null;
    contractState.relayerConfigKey = null;
    contractState.discovery = liveDiscoveryDefaults();
    if (el.contractStatus) showToast("No generated deployment manifest found.", "bad");
  }
  render();
  void maybeStartDragonWelcome();
}

async function connectWallet(options = {}) {
  const settings = options && !options.currentTarget ? options : {};
  const requestAccounts = settings.requestAccounts !== false;
  const quiet = Boolean(settings.quiet);
  const forceRequest = Boolean(settings.forceRequest);

  if (!window.ethers) {
    clearWalletConnection();
    if (!quiet) showToast("Browser ethers bundle did not load.", "bad");
    renderContractConnection();
    return false;
  }

  if (window.ethereum) {
    return await applyWalletProvider(window.ethereum, {
      quiet,
      requestAccounts,
      source: "injected",
    });
  }

  const metamaskConfigured = Boolean(window.CVCMetaMaskWallet?.isConfigured?.());
  if (metamaskConfigured) {
    try {
      const connection = await window.CVCMetaMaskWallet.connect({ requestAccounts, forceRequest });
      if (connection.status === "connected") {
        return await applyWalletProvider(connection.provider, {
          account: connection.address,
          providerType: connection.providerType,
          quiet,
          source: "metamask-connect",
        });
      }
      if (!requestAccounts) {
        clearWalletConnection();
        renderContractConnection();
        return false;
      }
    } catch (error) {
      if (!quiet) showToast(error?.shortMessage ?? error?.message ?? "MetaMask connection failed.", "bad");
      renderContractConnection();
      return false;
    }
  }

  clearWalletConnection();
  if (!quiet) showToast("No browser wallet provider found.", "bad");
  renderContractConnection();
  return false;
}

async function applyWalletProvider(rawProvider, options = {}) {
  const requestAccounts = options.requestAccounts !== false;
  const quiet = Boolean(options.quiet);
  const previousAccount = contractState.account;
  const previousChainId = contractState.chainId;

  try {
    contractState.walletProvider = rawProvider;
    contractState.walletProviderType = options.providerType ?? null;
    contractState.walletSource = options.source ?? "wallet";
    contractState.provider = new window.ethers.BrowserProvider(rawProvider);
    const accounts = options.account
      ? [options.account]
      : await contractState.provider.send(requestAccounts ? "eth_requestAccounts" : "eth_accounts", []);
    if (!accounts?.length) {
      clearWalletConnection();
      if (!quiet) showToast("Connect wallet before entering.", "bad");
      renderContractConnection();
      return false;
    }
    contractState.account = window.ethers.getAddress(accounts[0]);
    contractState.signer = await contractState.provider.getSigner(contractState.account);
    const network = await contractState.provider.getNetwork();
    contractState.chainId = network.chainId.toString();
    const walletChanged =
      previousAccount !== contractState.account || String(previousChainId ?? "") !== String(contractState.chainId);
    contractState.relayerInstance = null;
    contractState.relayerConfigKey = null;
    if (!quiet) showToast("Wallet connected.", "good");
    if (walletChanged || !contractState.discovery.updatedAt) {
      void refreshPublicBookDiscovery({ quiet: true });
    }
    render();
    return true;
  } catch (error) {
    if (!quiet) showToast(error?.shortMessage ?? error?.message ?? "Wallet connection failed.", "bad");
  }
  render();
  return false;
}

function clearWalletConnection() {
  contractState.provider = null;
  contractState.signer = null;
  contractState.account = null;
  contractState.chainId = null;
  contractState.walletProvider = null;
  contractState.walletProviderType = null;
  contractState.walletSource = null;
  contractState.relayerInstance = null;
  contractState.relayerConfigKey = null;
}

function hasUsableWalletConnection() {
  if (!window.ethers || !contractState.provider || !contractState.signer || !contractState.account) {
    return false;
  }
  if (!contractState.manifest?.chainId || !contractState.chainId) return true;
  return String(contractState.chainId) === String(contractState.manifest.chainId);
}

async function switchToManifestChain() {
  const walletProvider = activeWalletProvider();
  if (!walletProvider || !contractState.manifest?.chainId) return false;

  try {
    const chainIdHex = `0x${Number(contractState.manifest.chainId).toString(16)}`;
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return await connectWallet({ requestAccounts: false, quiet: true });
  } catch (error) {
    showToast(error?.shortMessage ?? error?.message ?? "Wallet chain switch failed.", "bad");
    return false;
  }
}

async function saveActivePreferenceBundle() {
  const bundle = activeBundle();
  if (canSubmitContractBundle()) {
    await submitActivePreferenceBundle();
    return;
  }
  warnIfRelayerSubmissionStub();
  markBundleSaved(bundle);
  saveState();
  render();
  showToast(localSaveMessage(), "good");
}

async function publishPrivateOffer() {
  if (offerPublishFlow.busy) return;
  const bundle = activeBundle();
  if (!bundle) {
    showToast("No active bundle.", "bad");
    return;
  }
  ensureBundleCollateralAsset(bundle);
  applySelectedCapitalToBundle(bundle);
  const capital = selectedCapitalRecord(bundle);
  const blocker = privateOfferBlocker(bundle, capital);
  if (blocker) {
    showToast(blocker, "bad");
    renderBuilderOnly();
    return;
  }

  startOfferPublishFlow(bundle);
  try {
    setOfferPublishStep("bundle", `Validating ${bundle.ownerRole} bundle against onboarded capital.`);
    const wasLocallySaved = bundleSaved(bundle);
    await Promise.resolve();
    completeOfferPublishStep("bundle");

    const existingOffer = await syncBundlePublicationFromChain(bundle, capital);
    if (existingOffer.message) setOfferPublishStep("preference", existingOffer.message);
    if (existingOffer.action === "already-executable") {
      completeOfferPublishStep("preference");
      completeOfferPublishStep("backing");
      completeOfferPublishStep("activate");
      saveState();
      await refreshPublicBookDiscovery({ quiet: true });
      const message = wasLocallySaved
        ? "Private offer is already executable on-chain."
        : "Private offer is already executable on-chain; local edits remain unpublished.";
      finishOfferPublishFlow(message);
      showToast(message, wasLocallySaved ? "good" : "bad");
      return;
    }

    if (!bundle.contractPreferenceId) {
      setOfferPublishStep("preference", "Submitting encrypted preference offer.");
      await submitPreferenceBundle(bundle);
    } else {
      setOfferPublishStep("preference", "Encrypted offer already exists for this bundle.");
    }
    completeOfferPublishStep("preference");

    if (!bundle.backingRegistered) {
      setOfferPublishStep("backing", "Registering capital backing evidence.");
      await registerPrivateOfferBacking(bundle, capital);
      bundle.backingRegistered = true;
      capital.usedByBundleId = bundle.bundleId;
      capital.preferenceId = bundle.contractPreferenceId;
      capital.backingRegistered = true;
      saveState();
    } else {
      setOfferPublishStep("backing", "Backing evidence already registered.");
    }
    completeOfferPublishStep("backing");

    if (!bundle.activated) {
      setOfferPublishStep("activate", "Activating backed offer for public discovery.");
      const preferenceBook = contractFor("ConfidentialPreferenceBook", contractState.signer);
      await (await preferenceBook.activateBacking(contractBackingId(bundle))).wait();
      bundle.activated = true;
      capital.activated = true;
      saveState();
    } else {
      setOfferPublishStep("activate", "Offer already executable.");
    }
    completeOfferPublishStep("activate");

    markBundleSaved(bundle);
    saveState();
    await refreshPublicBookDiscovery({ quiet: true });
    finishOfferPublishFlow("Private offer published and executable.");
    showToast("Private offer published.", "good");
  } catch (error) {
    failOfferPublishFlow(contractError(error, "Private offer publication failed."));
    showToast(offerPublishFlow.error, "bad");
  } finally {
    offerPublishFlow.busy = false;
    saveState();
    render();
  }
}

async function syncBundlePublicationFromChain(bundle, capital) {
  if (!bundle?.contractPreferenceId) return { action: "none", message: null };

  let preference;
  try {
    preference = await readPreferenceBundle(bundle.contractPreferenceId);
  } catch {
    resetBundlePublicationState(bundle);
    return {
      action: "cleared",
      message: "Previous offer id is not present on-chain; submitting the current bundle.",
    };
  }

  const status = Number(preference.status);
  if (!equalAddress(preference.manager, contractState.account)) {
    throw new Error(`Existing offer belongs to ${shortAddress(preference.manager)}.`);
  }

  const sameBacking = sameBytes32(preference.backingId, contractBackingId(bundle));
  const sameMetadata = preferenceMetadataMatchesBundle(preference, bundle);
  if (!sameBacking || !sameMetadata) {
    if (!isTerminalPreferenceStatus(status)) {
      throw new Error(
        `Existing offer is ${preferenceStatusLabel(status)} on-chain but no longer matches this local bundle. Remove this local bundle and create a fresh one for changed terms.`,
      );
    }
    resetBundlePublicationState(bundle);
    return {
      action: "cleared",
      message: `Previous offer is ${preferenceStatusLabel(status)} and no longer matches this bundle; submitting a fresh offer.`,
    };
  }

  if (isTerminalPreferenceStatus(status)) {
    resetBundlePublicationState(bundle);
    return {
      action: "cleared",
      message: `Previous offer is ${preferenceStatusLabel(status)}; submitting a fresh offer.`,
    };
  }

  bundle.contractOwnerAddress = preference.manager;
  if (status === PREFERENCE_STATUS.Executable) {
    bundle.backingRegistered = true;
    bundle.activated = true;
    if (capital) {
      capital.usedByBundleId = bundle.bundleId;
      capital.preferenceId = bundle.contractPreferenceId;
      capital.backingRegistered = true;
      capital.activated = true;
    }
    return { action: "already-executable", message: "Existing offer is already executable on-chain." };
  }

  if (status === PREFERENCE_STATUS.Submitted) {
    bundle.activated = false;
    return { action: "submitted", message: null };
  }

  return { action: "none", message: null };
}

async function readPreferenceBundle(preferenceId) {
  const preferenceBook = contractFor("ConfidentialPreferenceBook", contractState.signer ?? publicReadProvider());
  return preferenceBook.getPreferenceBundle(preferenceId);
}

function resetBundlePublicationState(bundle) {
  if (!bundle) return;
  bundle.contractPreferenceId = null;
  bundle.contractTxHash = null;
  bundle.contractOwnerAddress = null;
  bundle.backingRegistered = false;
  bundle.activated = false;
}

function preferenceMetadataMatchesBundle(preference, bundle) {
  const expected = contractMetadata(bundle);
  const metadata = preference.metadata;
  return (
    Number(metadata.side) === expected.side &&
    equalAddress(metadata.collateralToken, expected.collateralToken) &&
    equalAddress(metadata.tokenOpsManager, expected.tokenOpsManager) &&
    sameBytes32(metadata.principalBucket, expected.principalBucket) &&
    sameBytes32(metadata.durationBucket, expected.durationBucket)
  );
}

function isTerminalPreferenceStatus(status) {
  return [
    PREFERENCE_STATUS.Cancelled,
    PREFERENCE_STATUS.Expired,
    PREFERENCE_STATUS.Superseded,
    PREFERENCE_STATUS.Consumed,
  ].includes(Number(status));
}

function preferenceStatusLabel(status) {
  return (
    Object.entries(PREFERENCE_STATUS).find(([, value]) => value === Number(status))?.[0] ?? `status ${Number(status)}`
  );
}

function sameBytes32(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

function privateOfferBlocker(bundle, capital) {
  if (!capital) {
    return bundle.ownerRole === "lender"
      ? `Escrow ${CREDIT_TOKEN_LABEL} on Demo Utils before publishing lender offers.`
      : "Move vesting collateral into custody on Demo Utils before publishing borrower offers.";
  }
  const blocker = contractSubmissionBlockerMessage();
  if (blocker) return blocker;
  if (!canSubmitContractBundle()) return "Contract submission is not ready.";
  if (bundle.ownerRole === "lender" && !capital.commitmentEscrowed)
    return `Selected lender ${CREDIT_TOKEN_LABEL} is not escrowed.`;
  if (bundle.ownerRole === "borrower" && !capital.custodyAccepted)
    return "Selected borrower collateral is not in custody.";
  return null;
}

async function registerPrivateOfferBacking(bundle, capital) {
  const preferenceBook = contractFor("ConfidentialPreferenceBook", contractState.signer);
  const backingId = contractBackingId(bundle);
  if (bundle.ownerRole === "borrower") {
    const adapterAddress = manifestContractEntry("TokenOpsVestingAdapter").address;
    await (
      await preferenceBook.registerBorrowerBacking(
        backingId,
        window.ethers.getAddress(capital.managerAddress),
        adapterAddress,
        capital.vestingId,
      )
    ).wait();
    return;
  }

  await (
    await preferenceBook.registerLenderBacking(
      backingId,
      window.ethers.getAddress(capital.creditAdapter ?? manifestContractEntry("ERC7984CreditAdapter").address),
      capital.commitmentHash,
      Number(capital.commitmentExpiry),
    )
  ).wait();
}

function startOfferPublishFlow(bundle) {
  offerPublishFlow = {
    open: true,
    busy: true,
    role: bundle.ownerRole,
    bundleId: bundle.bundleId,
    currentStep: null,
    message: "Preparing encrypted offer publication.",
    error: null,
    completed: [],
  };
  renderOfferPublishModal();
}

function setOfferPublishStep(step, message) {
  offerPublishFlow.currentStep = step;
  offerPublishFlow.message = message;
  renderOfferPublishModal();
}

function completeOfferPublishStep(step) {
  offerPublishFlow.completed = [...new Set([...(offerPublishFlow.completed ?? []), step])];
  renderOfferPublishModal();
}

function finishOfferPublishFlow(message) {
  offerPublishFlow.busy = false;
  offerPublishFlow.currentStep = null;
  offerPublishFlow.message = message;
  offerPublishFlow.error = null;
  renderOfferPublishModal();
}

function failOfferPublishFlow(message) {
  offerPublishFlow.busy = false;
  offerPublishFlow.message = message;
  offerPublishFlow.error = message;
  renderOfferPublishModal();
}

function renderOfferPublishModal() {
  if (!el.offerPublishModal || !el.offerPublishSteps || !el.offerPublishMessage) return;
  el.offerPublishModal.hidden = !offerPublishFlow.open;
  if (!offerPublishFlow.open) return;
  el.offerPublishMessage.textContent = offerPublishFlow.error ?? offerPublishFlow.message;
  el.offerPublishMessage.classList.toggle("contract-error", Boolean(offerPublishFlow.error));
  el.offerPublishSteps.innerHTML = OFFER_PUBLISH_STEPS.map((step) => {
    const done = offerPublishFlow.completed?.includes(step.key);
    const active = offerPublishFlow.currentStep === step.key;
    const klass = done ? "done" : active ? "active" : "";
    return `<button class="${klass}" type="button" tabindex="0" data-tooltip="${escapeHtml(step.description)}" aria-label="${escapeHtml(`${step.label}: ${step.description}`)}">${escapeHtml(step.label)}</button>`;
  }).join("");
  if (el.offerPublishClose) {
    el.offerPublishClose.disabled = offerPublishFlow.busy;
    el.offerPublishClose.textContent = offerPublishFlow.busy ? "Publishing" : "Close";
  }
}

async function submitActivePreferenceBundle() {
  if (!canSubmitContractBundle()) {
    showToast(contractSubmissionBlockerMessage() ?? "Connect wallet before contract submission.", "bad");
    renderContractConnection();
    return;
  }

  const bundle = activeBundle();
  try {
    await submitPreferenceBundle(bundle);
    render();
    showToast("Preference bundle recorded on contract.", "good");
  } catch (error) {
    showToast(error?.shortMessage ?? error?.reason ?? error?.message ?? "Contract submission failed.", "bad");
  }
}

async function submitPreferenceBundle(bundle) {
  if (!bundle) throw new Error("No preference bundle selected.");
  const preferenceBook = contractState.manifest.contracts.ConfidentialPreferenceBook;
  const contract = new window.ethers.Contract(preferenceBook.address, preferenceBook.abi, contractState.signer);
  showToast("Encrypting preference bundle in browser.", "good");
  const input = await contractBundleInput(bundle, contractState.account);
  const tx = await contract.createPreferenceBundle(input);
  showToast("Preference transaction submitted.", "good");
  const receipt = await tx.wait();
  const parsed = receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "PreferenceCreated");

  bundle.contractPreferenceId = parsed?.args?.preferenceId ?? null;
  bundle.contractTxHash = receipt.hash;
  bundle.contractOwnerAddress = contractState.account;
  markBundleSaved(bundle);
  saveState();
  return bundle.contractPreferenceId;
}

function canSubmitContractBundle() {
  const bundle = activeBundle();
  return Boolean(
    window.ethers &&
    window.relayerSDK &&
    activeWalletProvider() &&
    contractState.manifest?.contracts?.ConfidentialPreferenceBook?.address &&
    contractState.signer &&
    contractState.account &&
    bundle &&
    hasContractCollateralConfig(bundle) &&
    String(contractState.chainId ?? "") === String(contractState.manifest.chainId) &&
    relayerConfigForManifest(),
  );
}

function hasContractCollateralConfig(bundle = activeBundle()) {
  return Boolean(
    (bundle?.collateralToken ?? contractState.manifest?.assets?.collateralToken) &&
    (bundle?.tokenOpsManager ?? contractState.manifest?.assets?.tokenOpsManager),
  );
}

function contractSubmissionBlockerMessage() {
  if (!contractState.manifest) return "Load the deployment manifest before contract submission.";
  if (!hasWalletConnector()) return "Install or enable a browser wallet before contract submission.";
  if (!contractState.account) return "Connect wallet before contract submission.";
  if (String(contractState.chainId ?? "") !== String(contractState.manifest.chainId)) {
    return `Switch wallet to chain ${contractState.manifest.chainId} before contract submission.`;
  }
  if (!window.relayerSDK) return "Relayer SDK unavailable for encrypted contract submission.";
  if (!relayerConfigForManifest()) return "Relayer config missing for encrypted contract submission.";
  if (!hasContractCollateralConfig(activeBundle())) {
    return "No TokenOps collateral token and manager are configured for contract submission.";
  }
  return null;
}

function canUseContracts(names) {
  return Boolean(
    window.ethers &&
    activeWalletProvider() &&
    contractState.manifest &&
    contractState.signer &&
    contractState.provider &&
    contractState.account &&
    String(contractState.chainId ?? "") === String(contractState.manifest.chainId) &&
    names.every((name) => manifestContractEntry(name)?.address),
  );
}

function demoWalletReady() {
  return Boolean(
    window.ethers &&
    activeWalletProvider() &&
    contractState.manifest &&
    contractState.signer &&
    contractState.provider &&
    contractState.account &&
    String(contractState.chainId ?? "") === String(contractState.manifest.chainId),
  );
}

async function refreshPublicBookDiscovery({ quiet = false } = {}) {
  if (!window.ethers || !contractState.manifest?.contracts?.ConfidentialPreferenceBook?.address) return;
  if (contractState.discoveryBusy) return;

  contractState.discoveryBusy = true;
  try {
    const previousDiscovery = contractState.discovery ?? liveDiscoveryDefaults();
    contractState.discovery = {
      ...previousDiscovery,
      status: previousDiscovery.updatedAt ? "Refreshing" : "Syncing",
      error: null,
    };
    renderBuckets();
    renderExecutionSummary();

    try {
      const serverDiscovery = await fetchServerDiscovery();
      if (serverDiscovery) {
        contractState.discovery = serverDiscovery;
        if (!quiet) showToast("Public buckets synced from server index.", "good");
      } else {
        await refreshPublicBookDiscoveryFromRpc({ quiet });
      }
    } catch (error) {
      contractState.discovery = {
        ...previousDiscovery,
        status: "Sync failed",
        error: contractError(error, "Public bucket sync failed."),
      };
      if (!quiet) showToast(contractState.discovery.error, "bad");
    }

    renderMetrics();
    renderBuckets();
    renderExecutionPanel();
    renderLoanList();
    renderLoanDetail();
  } finally {
    contractState.discoveryBusy = false;
  }
}

async function fetchServerDiscovery() {
  try {
    const response = await fetch("/api/discovery", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!Array.isArray(payload.buckets) || !Array.isArray(payload.preferences) || !Array.isArray(payload.loans)) {
      return null;
    }
    return normalizeServerDiscovery(payload);
  } catch {
    return null;
  }
}

function normalizeServerDiscovery(payload) {
  const preferences = payload.preferences ?? [];
  const loans = payload.loans ?? [];
  return {
    status: payload.status ?? "Server indexed",
    updatedAt: Number(payload.updatedAt ?? Date.now()),
    scannedFrom: Number(payload.scannedFrom ?? 0),
    scannedTo: Number(payload.scannedTo ?? 0),
    error: payload.error ?? null,
    preferences,
    buckets: payload.buckets ?? [],
    preferenceById:
      payload.preferenceById ??
      Object.fromEntries(preferences.map((preference) => [String(preference.preferenceId).toLowerCase(), preference])),
    loans,
    loanById: payload.loanById ?? Object.fromEntries(loans.map((loan) => [String(loan.loanId).toLowerCase(), loan])),
  };
}

async function refreshPublicBookDiscoveryFromRpc({ quiet = false } = {}) {
  const provider = publicReadProvider();
  const bookEntry = contractState.manifest.contracts.ConfidentialPreferenceBook;
  const book = new window.ethers.Contract(bookEntry.address, bookEntry.abi, provider);
  const iface = new window.ethers.Interface(bookEntry.abi);
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(
    0,
    latest - Number(contractState.manifest.discoveryLookbackBlocks ?? DISCOVERY_LOOKBACK_BLOCKS),
  );
  const logs = await getLogsChunked(provider, {
    address: bookEntry.address,
    topics: [iface.getEvent("PreferenceCreated").topicHash],
    fromBlock,
    toBlock: latest,
  });
  const created = logs
    .map((log) => {
      try {
        const parsed = iface.parseLog(log);
        return {
          preferenceId: parsed.args.preferenceId,
          side: Number(parsed.args.side),
          bucketKey: parsed.args.bucketKey,
          collateralToken: parsed.args.collateralToken,
          tokenOpsManager: parsed.args.tokenOpsManager,
          principalBucket: parsed.args.principalBucket,
          durationBucket: parsed.args.durationBucket,
          expiry: Number(parsed.args.expiry),
          blockNumber: log.blockNumber,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const deduped = [...new Map(created.map((event) => [event.preferenceId.toLowerCase(), event])).values()];
  const preferences = (await Promise.all(deduped.map((event) => executablePreferenceFromEvent(book, event)))).filter(
    Boolean,
  );
  const loans = await discoverLiveLoans(provider, fromBlock, latest);

  contractState.discovery = {
    status: `Synced ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    updatedAt: Date.now(),
    scannedFrom: fromBlock,
    scannedTo: latest,
    error: null,
    preferences,
    buckets: bucketsFromLivePreferences(preferences),
    preferenceById: Object.fromEntries(
      preferences.map((preference) => [preference.preferenceId.toLowerCase(), preference]),
    ),
    loans,
    loanById: Object.fromEntries(loans.map((loan) => [loan.loanId.toLowerCase(), loan])),
  };
  if (!quiet) showToast("Public buckets synced from Sepolia.", "good");
}

async function getLogsChunked(provider, filter) {
  const logs = [];
  const fromBlock = Number(filter.fromBlock ?? 0);
  const toBlock = Number(filter.toBlock);
  for (let start = fromBlock; start <= toBlock; start += DISCOVERY_CHUNK_BLOCKS + 1) {
    const end = Math.min(toBlock, start + DISCOVERY_CHUNK_BLOCKS);
    logs.push(...(await provider.getLogs({ ...filter, fromBlock: start, toBlock: end })));
  }
  return logs;
}

async function executablePreferenceFromEvent(book, event) {
  try {
    const preference = await book.getPreferenceBundle(event.preferenceId);
    const status = Number(preference.status);
    const expiry = Number(preference.metadata.expiry);
    if (status !== PREFERENCE_STATUS.Executable || expiry <= Math.floor(Date.now() / 1000)) return null;

    return {
      preferenceId: event.preferenceId,
      manager: preference.manager,
      backingId: preference.backingId,
      status,
      side: Number(preference.metadata.side) === 0 ? "borrower" : "lender",
      bucketKey: event.bucketKey,
      collateralToken: preference.metadata.collateralToken,
      tokenOpsManager: preference.metadata.tokenOpsManager,
      principalBucket: bytes32Label(preference.metadata.principalBucket),
      durationBucket: bytes32Label(preference.metadata.durationBucket),
      expiry,
      blockNumber: event.blockNumber,
    };
  } catch {
    return null;
  }
}

function bucketsFromLivePreferences(preferences) {
  const map = new Map();
  preferences.forEach((preference) => {
    const id = `${preference.side}:${preference.bucketKey}`;
    if (!map.has(id)) {
      map.set(id, {
        id,
        source: "chain",
        sourceLabel: "Sepolia executable",
        side: preference.side,
        assetClass: collateralName(preference.collateralToken, preference.tokenOpsManager),
        collateralToken: preference.collateralToken,
        tokenOpsManager: preference.tokenOpsManager,
        bucketKey: preference.bucketKey,
        principalBucket: preference.principalBucket,
        durationBucket: preference.durationBucket,
        count: 0,
        expiryDays: Infinity,
        candidateIds: [],
        managers: [],
      });
    }
    const bucket = map.get(id);
    bucket.count += 1;
    bucket.candidateIds.push(preference.preferenceId);
    bucket.managers.push(preference.manager);
    bucket.expiryDays = Math.min(
      bucket.expiryDays,
      Math.max(0, Math.ceil((preference.expiry - Math.floor(Date.now() / 1000)) / ONE_DAY)),
    );
  });

  return [...map.values()]
    .map((bucket) => ({
      ...bucket,
      expiryDays: Number.isFinite(bucket.expiryDays) ? bucket.expiryDays : 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function discoverLiveLoans(provider, fromBlock, toBlock) {
  const factoryEntry = contractState.manifest?.contracts?.LoanEscrowFactory;
  const escrowAbi = contractState.manifest?.abis?.LoanEscrow;
  if (!factoryEntry?.address || !factoryEntry?.abi || !escrowAbi) return [];

  const iface = new window.ethers.Interface(factoryEntry.abi);
  const logs = await getLogsChunked(provider, {
    address: factoryEntry.address,
    topics: [iface.getEvent("LoanCreated").topicHash],
    fromBlock,
    toBlock,
  });
  const events = logs
    .map((log) => {
      try {
        const parsed = iface.parseLog(log);
        return {
          loanId: parsed.args.loanId,
          escrowAddress: parsed.args.escrow,
          termsHash: parsed.args.termsHash,
          blockNumber: log.blockNumber,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const deduped = [...new Map(events.map((event) => [event.loanId.toLowerCase(), event])).values()];
  return (await Promise.all(deduped.map((event) => indexedLoanFromEvent(provider, event))))
    .filter(Boolean)
    .sort((a, b) => Number(b.blockNumber ?? 0) - Number(a.blockNumber ?? 0));
}

async function indexedLoanFromEvent(provider, event) {
  try {
    const escrow = new window.ethers.Contract(event.escrowAddress, contractState.manifest.abis.LoanEscrow, provider);
    const [
      borrower,
      lender,
      vestingAdapter,
      creditAdapter,
      tokenOpsManager,
      vestingId,
      dueTimestamp,
      gracePeriodSeconds,
      activationDeadline,
      fundingCommitmentHash,
      fundingAuthorizationHash,
      repaymentAuthorizationHash,
      encryptedTermsHash,
      stateValue,
      pledgeId,
      fundingCredited,
      repaymentCredited,
    ] = await Promise.all([
      escrow.borrower(),
      escrow.lender(),
      escrow.vestingAdapter(),
      escrow.creditAdapter(),
      escrow.tokenOpsManager(),
      escrow.vestingId(),
      escrow.dueTimestamp(),
      escrow.gracePeriodSeconds(),
      escrow.activationDeadline(),
      escrow.fundingCommitmentHash(),
      escrow.fundingAuthorizationHash(),
      escrow.repaymentAuthorizationHash(),
      escrow.encryptedTermsHash(),
      escrow.state(),
      escrow.pledgeId(),
      escrow.fundingCredited(),
      escrow.repaymentCredited(),
    ]);
    const pledge = await indexedPledgeState(provider, vestingAdapter, pledgeId);
    const status = LOAN_STATE[Number(stateValue)] ?? `State ${stateValue.toString()}`;
    const loan = {
      loanId: event.loanId,
      escrowAddress: event.escrowAddress,
      source: "chain",
      sourceLabel: "Sepolia indexed",
      indexedOnly: true,
      blockNumber: event.blockNumber,
      status,
      statusClass: loanStatusClass(status),
      borrowerLabel: shortAddress(borrower),
      lenderLabel: shortAddress(lender),
      borrowerAddress: borrower,
      lenderAddress: lender,
      contractBacked: true,
      realSettlement: true,
      collateralRegistered: pledgeId !== window.ethers.ZeroHash,
      fundingCredited,
      repaymentCredited,
      funded: null,
      paid: null,
      termsHash: event.termsHash,
      encryptedTermsHash,
      terms: {
        principal: null,
        collateralTokenPrice: null,
        interest: null,
        duration: null,
        grace: Math.round(Number(gracePeriodSeconds) / ONE_DAY),
      },
      principalAmount: null,
      totalDue: null,
      totalDueAmount: null,
      dueDays: Math.max(0, Math.ceil((Number(dueTimestamp) - Math.floor(Date.now() / 1000)) / ONE_DAY)),
      dueTimestamp: Number(dueTimestamp),
      gracePeriodSeconds: Number(gracePeriodSeconds),
      activationDeadline: Number(activationDeadline),
      fundingCommitmentHash,
      fundingAuthorizationHash,
      repaymentAuthorizationHash,
      fundingDeadline: null,
      vestingAdapter,
      vestingId,
      tokenOpsManager,
      creditAdapter,
      creditToken: contractState.manifest?.assets?.confidentialCreditToken ?? null,
      pledgeId: pledgeId === window.ethers.ZeroHash ? null : pledgeId,
      pledgeStatus: pledge.status,
      releaseRecipient: pledge.releaseRecipient,
      releaseCompleted: pledge.releaseCompleted,
      targetBucketId: null,
      events: indexedLoanEvents({ blockNumber: event.blockNumber, status, pledge, fundingCredited, repaymentCredited }),
    };
    return loan;
  } catch {
    return null;
  }
}

async function indexedPledgeState(provider, vestingAdapterAddress, pledgeId) {
  if (!pledgeId || pledgeId === window.ethers.ZeroHash) {
    return { status: "None", releaseRecipient: null, releaseCompleted: false };
  }
  const adapterEntry = contractState.manifest?.contracts?.TokenOpsVestingAdapter;
  if (!adapterEntry?.abi) return { status: "Unknown", releaseRecipient: null, releaseCompleted: false };
  try {
    const adapter = new window.ethers.Contract(vestingAdapterAddress, adapterEntry.abi, provider);
    const pledge = await adapter.getPledge(pledgeId);
    const pledgeStatus = Number(pledge.status);
    return {
      status: ["None", "Pledged", "ReleasePending", "Released"][pledgeStatus] ?? `Status ${pledgeStatus}`,
      releaseRecipient: pledgeStatus >= 2 ? pledge.releasedTo : null,
      releaseCompleted: pledgeStatus === 3,
    };
  } catch {
    return { status: "Unknown", releaseRecipient: null, releaseCompleted: false };
  }
}

function indexedLoanEvents({ blockNumber, status, pledge, fundingCredited, repaymentCredited }) {
  const events = [chainEventLine(blockNumber, "LoanCreated indexed from Sepolia")];
  if (pledge.status !== "None") events.push(chainEventLine(blockNumber, `TokenOps pledge ${pledge.status}`));
  if (fundingCredited) events.push(chainEventLine(blockNumber, "Funding credited according to escrow state"));
  if (status === "Active") events.push(chainEventLine(blockNumber, "Loan active according to escrow state"));
  if (repaymentCredited) events.push(chainEventLine(blockNumber, "Repayment credited according to escrow state"));
  if (["Repaid", "Defaulted", "Unwound"].includes(status)) {
    events.push(chainEventLine(blockNumber, `Loan closed as ${status}`));
  }
  return events;
}

function loanStatusClass(status) {
  if (status === "Defaulted") return "lender";
  if (status === "Repaid" || status === "Unwound") return "borrower";
  return "";
}

function publicReadProvider() {
  if (contractState.readProvider) return contractState.readProvider;
  const rpcUrl = contractState.manifest?.rpcUrl ?? contractState.manifest?.publicRpcUrl;
  if (!rpcUrl) throw new Error("Manifest does not expose a public RPC URL for discovery.");
  contractState.readProvider = new window.ethers.JsonRpcProvider(rpcUrl);
  return contractState.readProvider;
}

function livePreferenceById(preferenceId) {
  return preferenceId ? (contractState.discovery?.preferenceById?.[String(preferenceId).toLowerCase()] ?? null) : null;
}

function executableTargetBuckets(side, selectedBundle = null) {
  return (contractState.discovery?.buckets ?? []).filter(
    (bucket) =>
      bucket.side === side &&
      bucket.candidateIds.length &&
      (!selectedBundle || sameExecutionMarket(bucket, selectedBundle)),
  );
}

function executionBlockers(selectedBundle, selectedBucket) {
  const blockers = [];
  if (!contractState.manifest) blockers.push("Load the deployment manifest");
  if (!hasWalletConnector()) blockers.push("Install or enable a browser wallet");
  if (!contractState.account) blockers.push("Connect wallet");
  if (contractState.manifest && String(contractState.chainId ?? "") !== String(contractState.manifest.chainId)) {
    blockers.push(`Switch wallet to chain ${contractState.manifest.chainId}`);
  }
  if (!window.relayerSDK) blockers.push("Relayer SDK unavailable");
  if (!relayerConfigForManifest()) blockers.push("Relayer config missing");
  if (!selectedBundle) blockers.push(`No ${state.role} bundle selected`);
  if (selectedBundle && !selectedBundle.contractPreferenceId)
    blockers.push("Selected bundle is not submitted on-chain");
  if (
    selectedBundle?.contractOwnerAddress &&
    contractState.account &&
    !equalAddress(selectedBundle.contractOwnerAddress, contractState.account)
  ) {
    blockers.push(`Selected bundle was submitted by ${shortAddress(selectedBundle.contractOwnerAddress)}`);
  }
  if (selectedBundle?.contractPreferenceId && !livePreferenceById(selectedBundle.contractPreferenceId)) {
    blockers.push("Selected bundle is not executable on-chain");
  }
  if (!selectedBucket) {
    const opposite = oppositeRole(state.role);
    blockers.push(
      selectedBundle
        ? `No ${opposite} executable bucket matches ${executionMarketLabel(selectedBundle)}`
        : `No ${opposite} executable bucket selected`,
    );
  }
  if (selectedBucket && !selectedBucket.candidateIds?.length)
    blockers.push("Selected bucket has no executable candidates");
  if (selectedBundle && selectedBucket && !sameExecutionMarket(selectedBucket, selectedBundle)) {
    blockers.push("Selected bucket uses a different collateral market than your bundle");
  }
  if (
    !canUseContracts([
      "BondManager",
      "NashNegotiationEngine",
      "MatchSettlementCoordinator",
      "ConfidentialPreferenceBook",
    ])
  ) {
    blockers.push("Required matcher contracts are unavailable");
  }
  return [...new Set(blockers)];
}

function collateralAssets() {
  const assets = [];
  const seen = new Set();
  const addAsset = (asset) => {
    const tokenAddress = asset.tokenAddress ?? null;
    const managerAddress = asset.managerAddress ?? null;
    const key =
      tokenAddress && managerAddress
        ? `${String(tokenAddress).toLowerCase()}:${String(managerAddress).toLowerCase()}`
        : asset.id;
    if (seen.has(key)) return;
    seen.add(key);
    assets.push(asset);
  };

  (state.demoUtils?.collateralAssets ?? []).forEach((asset, index) => {
    if (!asset.tokenAddress) return;
    const metadata = collateralMetadataFor(asset.tokenAddress);
    addAsset({
      id: `demo:${asset.tokenAddress}:${asset.managerAddress ?? "pending"}`,
      label: metadata?.tokenName ?? asset.tokenName ?? asset.label ?? `Demo collateral ${index + 1}`,
      tokenName: metadata?.tokenName ?? asset.tokenName ?? null,
      tokenSymbol: metadata?.tokenSymbol ?? asset.tokenSymbol ?? null,
      tokenAddress: asset.tokenAddress,
      managerAddress: asset.managerAddress,
      source: "demo",
    });
  });

  (contractState.discovery?.buckets ?? []).forEach((bucket, index) => {
    const tokenAddress = bucket.collateralToken ?? null;
    const managerAddress = bucket.tokenOpsManager ?? null;
    if (!tokenAddress || !managerAddress) return;
    const metadata = collateralMetadataFor(tokenAddress);
    addAsset({
      id: `book:${tokenAddress}:${managerAddress}`,
      label: metadata?.tokenName ?? bucket.assetClass ?? `Public collateral market ${index + 1}`,
      tokenName: metadata?.tokenName ?? null,
      tokenSymbol: metadata?.tokenSymbol ?? null,
      tokenAddress,
      managerAddress,
      source: "book",
    });
  });

  const manifestToken = contractState.manifest?.assets?.collateralToken ?? null;
  const manifestManager = contractState.manifest?.assets?.tokenOpsManager ?? null;
  if (manifestToken && manifestManager) {
    const metadata = collateralMetadataFor(manifestToken);
    addAsset({
      id: `manifest:${manifestToken}:${manifestManager}`,
      label: metadata?.tokenName ?? "Manifest collateral",
      tokenName: metadata?.tokenName ?? null,
      tokenSymbol: metadata?.tokenSymbol ?? null,
      tokenAddress: manifestToken,
      managerAddress: manifestManager,
      source: "manifest",
    });
  }

  if (assets.length === 0) {
    assets.push({
      id: "unconfigured",
      label: "No collateral configured",
      tokenAddress: null,
      managerAddress: null,
      source: "empty",
    });
  }
  return assets;
}

function collateralAssetForBundle(bundle) {
  const assets = collateralAssets();
  const exact = assets.find(
    (asset) =>
      asset.tokenAddress &&
      asset.managerAddress &&
      equalAddress(asset.tokenAddress, bundle.collateralToken) &&
      equalAddress(asset.managerAddress, bundle.tokenOpsManager),
  );
  return exact ?? assets.find((asset) => asset.managerAddress) ?? assets[0];
}

function ensureBundleCollateralAsset(bundle, preferredAsset = null) {
  if (!bundle || (bundle.collateralToken && bundle.tokenOpsManager)) return false;
  const asset = preferredAsset ?? collateralAssetForBundle(bundle);
  if (!asset?.tokenAddress || !asset?.managerAddress) return false;
  applyCollateralAssetToBundle(bundle, asset);
  return true;
}

function applyCollateralAssetToBundle(bundle, asset) {
  bundle.assetClass = displayTokenName(asset);
  bundle.collateralToken = asset.tokenAddress;
  bundle.tokenOpsManager = asset.managerAddress;
}

function rememberCollateralAsset(asset) {
  state.demoUtils.collateralAssets ??= [];
  storeCollateralMetadata(asset.tokenAddress, {
    tokenName: asset.tokenName ?? asset.label ?? null,
    tokenSymbol: asset.tokenSymbol ?? null,
  });
  const existing = state.demoUtils.collateralAssets.find((candidate) =>
    equalAddress(candidate.tokenAddress, asset.tokenAddress),
  );
  if (existing) {
    existing.label = asset.label ?? existing.label;
    existing.tokenName = asset.tokenName ?? existing.tokenName;
    existing.tokenSymbol = asset.tokenSymbol ?? existing.tokenSymbol;
    existing.managerAddress = asset.managerAddress ?? existing.managerAddress;
    return;
  }
  state.demoUtils.collateralAssets.push(asset);
}

function storeCollateralMetadata(tokenAddress, metadata = {}) {
  if (!tokenAddress || (!metadata.tokenName && !metadata.tokenSymbol)) return;
  state.demoUtils.collateralMetadata ??= {};
  const key = String(tokenAddress).toLowerCase();
  const previous = state.demoUtils.collateralMetadata[key] ?? {};
  state.demoUtils.collateralMetadata[key] = {
    tokenName: metadata.tokenName ?? previous.tokenName ?? null,
    tokenSymbol: metadata.tokenSymbol ?? previous.tokenSymbol ?? null,
  };
}

function collateralAssetLabel(tokenAddress) {
  const existing = state.demoUtils.collateralAssets?.find((asset) => equalAddress(asset.tokenAddress, tokenAddress));
  return (
    collateralMetadataFor(tokenAddress)?.tokenName ??
    existing?.tokenName ??
    existing?.label ??
    `Demo collateral ${state.demoUtils.collateralAssets.length + 1}`
  );
}

function collateralAssetOptionLabel(asset) {
  if (!asset?.tokenAddress || !asset?.managerAddress) return asset?.label ?? "Not configured";
  return `${displayTokenName(asset)} | token ${shortAddress(asset.tokenAddress)} | vest ${shortAddress(asset.managerAddress)}`;
}

function collateralAssetTitle(asset) {
  if (!asset?.tokenAddress || !asset?.managerAddress) return asset?.label ?? "Not configured";
  return `${displayTokenName(asset)} | token ${asset.tokenAddress} | vesting manager ${asset.managerAddress}`;
}

function collateralMarketLabel(source) {
  const asset = collateralMarketAsset(source);
  if (!asset.tokenAddress || !asset.managerAddress) return asset.label;
  requestCollateralMetadata(asset);
  return collateralAssetOptionLabel(asset);
}

function executionMarketLabel(source) {
  const normalized = executableMarketSource(source);
  return `${collateralMarketLabel(normalized)} | ${principalBucketLabelOf(normalized)} | ${durationBucketLabelOf(normalized)}`;
}

function collateralMarketAsset(source) {
  const tokenAddress = collateralTokenAddressOf(source);
  const managerAddress = tokenOpsManagerAddressOf(source);
  return {
    label: tokenAddress && managerAddress ? collateralName(tokenAddress, managerAddress) : "Not configured",
    tokenAddress,
    managerAddress,
    source: "chain",
  };
}

function collateralTokenAddressOf(source) {
  return source?.tokenAddress ?? source?.collateralToken ?? null;
}

function tokenOpsManagerAddressOf(source) {
  return source?.managerAddress ?? source?.tokenOpsManager ?? null;
}

function sameCollateralMarket(left, right) {
  const normalizedLeft = executableMarketSource(left);
  const normalizedRight = executableMarketSource(right);
  return (
    equalAddress(collateralTokenAddressOf(normalizedLeft), collateralTokenAddressOf(normalizedRight)) &&
    equalAddress(tokenOpsManagerAddressOf(normalizedLeft), tokenOpsManagerAddressOf(normalizedRight))
  );
}

function sameExecutionMarket(left, right) {
  const normalizedLeft = executableMarketSource(left);
  const normalizedRight = executableMarketSource(right);
  return (
    sameCollateralMarket(normalizedLeft, normalizedRight) &&
    sameBucketLabel(principalBucketLabelOf(normalizedLeft), principalBucketLabelOf(normalizedRight)) &&
    sameBucketLabel(durationBucketLabelOf(normalizedLeft), durationBucketLabelOf(normalizedRight))
  );
}

function executableMarketSource(source) {
  return source?.contractPreferenceId ? (livePreferenceById(source.contractPreferenceId) ?? source) : source;
}

function principalBucketLabelOf(source) {
  const normalized = executableMarketSource(source);
  return (
    normalized?.principalBucket ??
    (normalized?.principal ? contractPrincipalBucketLabel(normalized) : "Unknown principal")
  );
}

function durationBucketLabelOf(source) {
  const normalized = executableMarketSource(source);
  return (
    normalized?.durationBucket ??
    (normalized?.durationDays ? contractDurationBucketLabel(normalized) : "Unknown duration")
  );
}

function sameBucketLabel(left, right) {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function displayTokenName(source) {
  if (!source) return "Collateral";
  return (
    source.tokenName ??
    collateralMetadataFor(source.tokenAddress)?.tokenName ??
    source.label ??
    (source.tokenAddress ? shortAddress(source.tokenAddress) : "Collateral")
  );
}

function collateralMetadataFor(tokenAddress) {
  if (!tokenAddress) return null;
  const metadata = state.demoUtils?.collateralMetadata?.[String(tokenAddress).toLowerCase()];
  if (metadata?.tokenName || metadata?.tokenSymbol) return metadata;
  const existing = state.demoUtils?.collateralAssets?.find((asset) => equalAddress(asset.tokenAddress, tokenAddress));
  if (!existing) return null;
  return existing.tokenName || existing.tokenSymbol
    ? { tokenName: existing.tokenName ?? existing.label ?? null, tokenSymbol: existing.tokenSymbol ?? null }
    : null;
}

function requestCollateralMetadata(asset) {
  if (!asset?.tokenAddress || !window.ethers) return;
  const key = asset.tokenAddress.toLowerCase();
  if (collateralMetadataRequests.has(key) || collateralMetadataFor(asset.tokenAddress)?.tokenName) return;
  const runner = metadataReadRunner();
  if (!runner) return;
  collateralMetadataRequests.add(key);
  const token = new window.ethers.Contract(asset.tokenAddress, ERC20_METADATA_ABI, runner);
  Promise.allSettled([token.name(), token.symbol()])
    .then(([nameResult, symbolResult]) => {
      const tokenName = nameResult.status === "fulfilled" ? sanitizeTokenName(nameResult.value) : null;
      const tokenSymbol = symbolResult.status === "fulfilled" ? sanitizeTokenSymbol(symbolResult.value) : null;
      if (!tokenName && !tokenSymbol) return;
      storeCollateralMetadata(asset.tokenAddress, { tokenName, tokenSymbol });
      if (asset.source !== "manifest") {
        rememberCollateralAsset({
          ...asset,
          label: tokenName ?? asset.label,
          tokenName,
          tokenSymbol,
        });
      }
      syncCollateralMetadataToLocalRecords(asset.tokenAddress, { tokenName, tokenSymbol });
      saveState();
      renderBuckets();
      renderBuilderOnly();
      renderDemoUtils();
      renderExecutionPanel();
    })
    .catch(() => {});
}

function metadataReadRunner() {
  if (contractState.provider) return contractState.provider;
  if (contractState.readProvider) return contractState.readProvider;
  try {
    return publicReadProvider();
  } catch {
    return null;
  }
}

function syncCollateralMetadataToLocalRecords(tokenAddress, metadata) {
  if (!tokenAddress) return;
  const apply = (record) => {
    if (!equalAddress(record.tokenAddress, tokenAddress)) return;
    record.tokenName = metadata.tokenName ?? record.tokenName;
    record.tokenSymbol = metadata.tokenSymbol ?? record.tokenSymbol;
    record.label = metadata.tokenName ?? record.label;
  };
  (state.demoUtils.collateralAssets ?? []).forEach(apply);
  (state.demoUtils.borrowerCapital ?? []).forEach(apply);
  state.bundles.forEach((bundle) => {
    if (!equalAddress(bundle.collateralToken, tokenAddress)) return;
    bundle.assetClass = metadata.tokenName ?? bundle.assetClass;
  });
}

function currentBorrowerTokenName() {
  return sanitizeTokenName(state.demoUtils.borrowerTokenName || "Demo Vested Collateral");
}

function sanitizeTokenName(value) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);
  return text || "Demo Vested Collateral";
}

function sanitizeTokenSymbol(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12);
}

function tokenSymbolFromName(name) {
  const clean = sanitizeTokenName(name);
  if (clean === "Demo Vested Collateral") return "dVEST";
  const initials = clean
    .split(" ")
    .map((part) => part.match(/[a-zA-Z0-9]/)?.[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 8);
  return initials.length >= 2 ? initials : sanitizeTokenSymbol(clean).toUpperCase().slice(0, 8) || "dVEST";
}

function equalAddress(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function hasDemoArtifact(name) {
  return Boolean(
    contractState.manifest?.demoArtifacts?.[name]?.abi && contractState.manifest?.demoArtifacts?.[name]?.bytecode,
  );
}

function positiveTokenAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("Enter a positive amount.");
  return window.ethers.parseUnits(String(value), 18);
}

function creditDisplayToBaseUnits(value) {
  const text = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid ${CREDIT_TOKEN_LABEL} amount.`);
  const [whole, fraction = ""] = text.split(".");
  const scale = 10n ** BigInt(CREDIT_TOKEN_DECIMALS);
  const fractional = (fraction + "0".repeat(CREDIT_TOKEN_DECIMALS)).slice(0, CREDIT_TOKEN_DECIMALS);
  return BigInt(whole || "0") * scale + BigInt(fractional || "0");
}

function creditBaseUnitsToDisplay(value) {
  const amount = BigInt(value ?? 0);
  const scale = 10n ** BigInt(CREDIT_TOKEN_DECIMALS);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (fraction === 0n) return Number(whole);
  return Number(`${whole}.${fraction.toString().padStart(CREDIT_TOKEN_DECIMALS, "0").replace(/0+$/, "")}`);
}

function warnDemoUtility(key, message) {
  if (!warnedPlaceholders.has(key)) {
    warnedPlaceholders.add(key);
    console.warn(message);
  }
}

function contractFor(name, runner = contractState.signer) {
  const entry = manifestContractEntry(name);
  if (!entry?.address || !entry?.abi) throw new Error(`Manifest missing ${name}`);
  return new window.ethers.Contract(entry.address, entry.abi, runner);
}

function manifestContractEntry(name) {
  return contractState.manifest?.contracts?.[name] ?? contractState.manifest?.mockContracts?.[name];
}

function demoContractAt(name, address, runner = contractState.signer) {
  const entry = contractState.manifest?.demoContracts?.[name];
  const artifact = contractState.manifest?.demoArtifacts?.[name];
  const abi = entry?.abi ?? artifact?.abi;
  if (!abi) throw new Error(`Manifest missing demo ABI ${name}`);
  return new window.ethers.Contract(address, abi, runner);
}

function creditAdapterContract(loan, runner = contractState.signer) {
  const entry = contractState.manifest?.contracts?.ERC7984CreditAdapter;
  const address = loan?.creditAdapter ?? entry?.address;
  if (!address || !entry?.abi) throw new Error("Manifest missing ERC7984CreditAdapter ABI or address");
  return new window.ethers.Contract(address, entry.abi, runner);
}

function confidentialCreditTokenContract(runner = contractState.signer) {
  const address = contractState.manifest?.assets?.confidentialCreditToken;
  if (!address) throw new Error("Manifest missing confidential credit token address");
  return new window.ethers.Contract(address, ERC7984_TOKEN_ABI, runner);
}

function tokenOpsManagerContract(address, runner = contractState.signer) {
  if (!address) throw new Error("TokenOps manager address missing");
  return new window.ethers.Contract(address, TOKEN_OPS_MANAGER_ABI, runner);
}

function demoArtifactFactory(name) {
  const artifact = contractState.manifest?.demoArtifacts?.[name];
  if (!artifact?.abi || !artifact?.bytecode) throw new Error(`Manifest missing deployable demo artifact ${name}`);
  return new window.ethers.ContractFactory(artifact.abi, artifact.bytecode, contractState.signer);
}

function loanEscrowContract(loan, runner = contractState.signer) {
  const abi = contractState.manifest?.abis?.LoanEscrow;
  if (!loan.escrowAddress || !abi) throw new Error("Manifest missing LoanEscrow ABI or escrow address");
  return new window.ethers.Contract(loan.escrowAddress, abi, runner);
}

function warnLocalPlaceholder(key, message) {
  if (!warnedPlaceholders.has(key)) {
    warnedPlaceholders.add(key);
    console.warn(message);
  }
  showToast(message, "bad");
}

function contractError(error, fallback) {
  return decodeKnownContractError(error) ?? error?.shortMessage ?? error?.reason ?? error?.message ?? fallback;
}

function decodeKnownContractError(error) {
  const data = findHexErrorData(error);
  if (!data || !window.ethers || !contractState.manifest) return null;
  const contractGroups = [
    contractState.manifest.contracts,
    contractState.manifest.mockContracts,
    contractState.manifest.demoContracts,
  ].filter(Boolean);

  for (const group of contractGroups) {
    for (const entry of Object.values(group)) {
      if (!entry?.abi) continue;
      try {
        const parsed = new window.ethers.Interface(entry.abi).parseError(data);
        if (!parsed) continue;
        const args = parsed.args?.length ? `(${parsed.args.map((arg) => String(arg)).join(", ")})` : "";
        return `${parsed.name}${args}`;
      } catch {
        // Keep trying other known ABIs.
      }
    }
  }
  return null;
}

function findHexErrorData(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) return value;
  if (typeof value !== "object") return null;
  for (const key of ["data", "error", "info", "cause"]) {
    const found = findHexErrorData(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function contractBundleInput(bundle, account) {
  const encrypted = await encryptedContractFields(bundle, account);
  return {
    metadata: contractMetadata(bundle),
    backingId: contractBackingId(bundle),
    ...encrypted,
  };
}

async function encryptedContractFields(bundle, account) {
  const relayer = await getRelayerInstance();
  const bookAddress = contractState.manifest.contracts.ConfidentialPreferenceBook.address;
  const builder = relayer.createEncryptedInput(
    window.ethers.getAddress(bookAddress),
    window.ethers.getAddress(account),
  );
  const fields = [
    contractField(bundle.collateralAmount, 1, priorityLevel(bundle, "collateralAmount")),
    contractField(bundle.principal, 1, priorityLevel(bundle, "principal")),
    contractField(impliedPricePreference(bundle), 100_000_000, priorityLevel(bundle, "collateralAmount")),
    contractField(bundle.interestBps, 100, priorityLevel(bundle, "interestBps")),
    contractField(bundle.durationDays, 1, priorityLevel(bundle, "durationDays")),
    contractField(bundle.gracePeriodDays, 1, priorityLevel(bundle, "gracePeriodDays")),
  ];

  fields.forEach((field) => {
    builder.add64(field.range.min);
    builder.add64(field.range.max);
    builder.add64(field.range.target);
    builder.add8(field.direction);
    builder.add8(field.priority);
  });

  const proof = builder.generateZKProof();
  const { handles, inputProof } = await relayer.requestZKProofVerification(proof);
  let cursor = 0;
  const nextField = () => ({
    range: {
      min: hexBytes32(handles[cursor++]),
      max: hexBytes32(handles[cursor++]),
      target: hexBytes32(handles[cursor++]),
    },
    direction: hexBytes32(handles[cursor++]),
    priority: hexBytes32(handles[cursor++]),
  });

  return {
    collateralAmount: nextField(),
    principal: nextField(),
    collateralTokenPriceE8: nextField(),
    interestBps: nextField(),
    durationDays: nextField(),
    gracePeriodDays: nextField(),
    inputProof: window.ethers.hexlify(inputProof),
  };
}

async function encryptedUint64(contractAddress, account, amount) {
  const relayer = await getRelayerInstance();
  const builder = relayer.createEncryptedInput(
    window.ethers.getAddress(contractAddress),
    window.ethers.getAddress(account),
  );
  builder.add64(BigInt(amount));
  const encrypted = await builder.encrypt();
  return {
    handle: hexBytes32(encrypted.handles[0]),
    inputProof: window.ethers.hexlify(encrypted.inputProof),
  };
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  });
}

function contractField(field, multiplier, priority = 3) {
  return {
    range: {
      min: BigInt(Math.round(field.range.min * multiplier)),
      max: BigInt(Math.round(field.range.max * multiplier)),
      target: BigInt(Math.round(field.range.target * multiplier)),
    },
    direction: BigInt(directionEnum(field.direction)),
    priority: BigInt(priority - 1),
  };
}

function contractMetadata(bundle) {
  const tokenOpsManager = contractTokenOpsManagerAddress(bundle);
  return {
    side: bundle.ownerRole === "borrower" ? 0 : 1,
    collateralToken: contractCollateralTokenAddress(bundle),
    tokenOpsManager,
    principalBucket: contractPrincipalBucket(bundle),
    durationBucket: contractDurationBucket(bundle),
    expiry: Math.floor(Date.now() / 1000) + bundle.expiryDays * 24 * 60 * 60,
  };
}

function contractPrincipalBucket(bundle) {
  return asciiBytes32(contractPrincipalBucketLabel(bundle));
}

function contractPrincipalBucketLabel(bundle) {
  const p = bundle.principal.range;
  return `P<${String(ceilingBucket(p.max, PRINCIPAL_CEILING_BUCKETS, 250_000)).padStart(6, "0")}`;
}

function contractDurationBucket(bundle) {
  return asciiBytes32(contractDurationBucketLabel(bundle));
}

function contractDurationBucketLabel(bundle) {
  const d = bundle.durationDays.range;
  return `D<${String(ceilingBucket(d.max, DURATION_CEILING_BUCKETS, 365)).padStart(6, "0")}`;
}

function ceilingBucket(maxValue, fixedBuckets, overflowStep) {
  const normalizedMax = Math.max(0, Number(maxValue) || 0);
  const bucket = fixedBuckets.find((candidate) => normalizedMax <= candidate);
  if (bucket) return bucket;
  return Math.ceil(normalizedMax / overflowStep) * overflowStep;
}

function contractBackingId(bundle) {
  return window.ethers.keccak256(window.ethers.toUtf8Bytes(`cvc:backing:${bundle.bundleId}`));
}

function contractCollateralTokenAddress(bundle = activeBundle()) {
  const address = bundle?.collateralToken ?? contractState.manifest.assets?.collateralToken;
  if (!address) {
    throw new Error("No TokenOps collateral token is configured for contract submission.");
  }
  return window.ethers.getAddress(address);
}

function contractTokenOpsManagerAddress(bundle = activeBundle()) {
  const address = bundle?.tokenOpsManager ?? contractState.manifest.assets?.tokenOpsManager;
  if (!address) {
    throw new Error("No TokenOps vesting manager is configured for contract submission.");
  }
  return window.ethers.getAddress(address);
}

function asciiBytes32(value) {
  return window.ethers.encodeBytes32String(value);
}

function bytes32Label(value) {
  try {
    return window.ethers.decodeBytes32String(value);
  } catch {
    return shortHash(value);
  }
}

function hexBytes32(value) {
  return window.ethers.hexlify(value);
}

function collateralName(collateralToken, tokenOpsManager) {
  const manifestAssets = contractState.manifest?.assets ?? {};
  if (
    equalAddress(collateralToken, manifestAssets.collateralToken) &&
    equalAddress(tokenOpsManager, manifestAssets.tokenOpsManager)
  ) {
    return "Manifest collateral";
  }
  return `${shortAddress(collateralToken)} / ${shortAddress(tokenOpsManager)}`;
}

function directionEnum(value) {
  if (value === "lower_is_better") return 0;
  if (value === "higher_is_better") return 1;
  if (value === "target_is_best") return 2;
  return 3;
}

async function getRelayerInstance() {
  const config = relayerConfigForManifest();
  if (!config) {
    throw new Error("Manifest does not contain relayer configuration for this network");
  }

  const key = JSON.stringify({
    chainId: config.chainId,
    relayerUrl: config.relayerUrl,
    aclContractAddress: config.aclContractAddress,
    inputVerifierContractAddress: config.inputVerifierContractAddress,
  });
  if (contractState.relayerInstance && contractState.relayerConfigKey === key) {
    return contractState.relayerInstance;
  }

  await window.relayerSDK.initSDK({
    tfheParams: "./vendor/relayer-sdk/tfhe_bg.wasm",
    kmsParams: "./vendor/relayer-sdk/kms_lib_bg.wasm",
    thread: undefined,
  });
  contractState.relayerInstance = await window.relayerSDK.createInstance(config);
  contractState.relayerConfigKey = key;
  return contractState.relayerInstance;
}

async function publicDecryptBoolean(handle) {
  const relayer = await getRelayerInstance();
  const normalizedHandle = handleToBytes32(handle);
  const decrypted = await relayer.publicDecrypt([normalizedHandle]);
  return {
    value: Boolean(decrypted.clearValues[normalizedHandle]),
    decryptionProof: decrypted.decryptionProof,
  };
}

function handleToBytes32(handle) {
  if (typeof handle === "bigint") return window.ethers.toBeHex(handle, 32);
  return window.ethers.hexlify(handle);
}

function relayerConfigForManifest() {
  const walletProvider = activeWalletProvider();
  if (!contractState.manifest || !walletProvider || !window.relayerSDK) return null;
  const chainId = Number(contractState.manifest.chainId);
  if (chainId === 11155111) {
    return {
      ...window.relayerSDK.SepoliaConfig,
      network: walletProvider,
    };
  }
  const fhevm = contractState.manifest.fhevm;
  if (!fhevm?.relayerUrl) return null;
  return {
    verifyingContractAddressDecryption: fhevm.verifyingContractAddressDecryption,
    verifyingContractAddressInputVerification: fhevm.verifyingContractAddressInputVerification,
    kmsContractAddress: fhevm.kmsContractAddress,
    inputVerifierContractAddress: fhevm.inputVerifierContractAddress,
    aclContractAddress: fhevm.aclContractAddress,
    gatewayChainId: Number(fhevm.gatewayChainId),
    relayerUrl: fhevm.relayerUrl,
    network: walletProvider,
    chainId,
    batchRpcCalls: fhevm.batchRpcCalls ?? true,
    relayerRouteVersion: fhevm.relayerRouteVersion ?? 2,
  };
}

function warnIfRelayerSubmissionStub() {
  if (!contractState.manifest || !contractState.account || relayerConfigForManifest()) return;
  console.warn(
    "WARNING: Real encrypted Preference Bundle submission is stubbed on this network because the deployment manifest " +
      "does not include fhevm relayer config. Sepolia uses the Zama SDK defaults; localhost/custom chains require " +
      "manifest.fhevm before createPreferenceBundle can be called from the browser.",
  );
}

function localSaveMessage() {
  const blocker = contractSubmissionBlockerMessage();
  if (blocker) return `Saved locally. ${blocker}`;
  if (contractState.manifest && contractState.account && !relayerConfigForManifest()) {
    return "Saved locally. Contract submission is blocked until relayer config is present.";
  }
  return "Preference bundle saved locally.";
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error("unsupported manifest schema");
  if (!manifest.contracts?.ConfidentialPreferenceBook?.address) throw new Error("missing PreferenceBook");
  if (!Array.isArray(manifest.contracts.ConfidentialPreferenceBook.abi)) throw new Error("missing PreferenceBook ABI");
  if (!manifest.contracts?.ERC7984CreditAdapter?.address) throw new Error("missing ERC7984CreditAdapter");
  if (!Array.isArray(manifest.contracts.ERC7984CreditAdapter.abi)) throw new Error("missing ERC7984CreditAdapter ABI");
  if (!Array.isArray(manifest.abis?.LoanEscrow)) throw new Error("missing LoanEscrow ABI");
}

function loanActionButton(loan, action, label) {
  const enabled = isLoanActionEnabled(loan, action);
  return `<button type="button" data-action="${action}" ${enabled ? "" : "disabled"}>${label}</button>`;
}

function isLoanActionEnabled(loan, action) {
  if (loan.contractBacked && !loan.realSettlement && !isLocalManifestChain() && MOCK_BACKED_LOAN_ACTIONS.has(action)) {
    return false;
  }
  if (action === "register-collateral") return loan.status === "AwaitingEscrow" && !loan.collateralRegistered;
  if (action === "fund") {
    if (loan.realSettlement && loan.fundingDeadline && Number(loan.fundingDeadline) <= Math.floor(Date.now() / 1000)) {
      return false;
    }
    return loan.status === "AwaitingEscrow" && !loan.fundingCredited;
  }
  if (action === "activate") {
    return loan.status === "AwaitingEscrow" && loan.collateralRegistered && loan.fundingCredited;
  }
  if (action === "repay") {
    if (loan.realSettlement && !loan.totalDueAmount) return false;
    if (loan.realSettlement && (!contractState.account || !equalAddress(contractState.account, loan.borrowerAddress))) {
      return false;
    }
    return loan.status === "Active";
  }
  if (action === "check-default") return loan.status === "Active";
  if (action === "unwind") return loan.status === "AwaitingEscrow";
  if (action === "complete-release") {
    return loan.realSettlement && isClosedLoan(loan) && !loan.releaseCompleted && Boolean(loan.releaseRecipient);
  }
  return false;
}

function isClosedLoan(loan) {
  return ["Repaid", "Defaulted", "Unwound"].includes(loan.status);
}

function stepPill(label, complete) {
  return `<span class="${complete ? "complete" : ""}">${label}</span>`;
}

function eventLine(text) {
  return {
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    text,
  };
}

function chainEventLine(blockNumber, text) {
  return {
    time: blockNumber ? `#${blockNumber}` : "Chain",
    text,
  };
}

function drawPriorityPolygon(bundle) {
  const canvas = el.utilityChart;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const center = { x: width / 2, y: height / 2 };
  const maxRadius = Math.min(width, height) * 0.34;
  const labelRadius = maxRadius + 34;
  const points = priorityPoints(bundle, center, maxRadius);

  ctx.strokeStyle = "rgba(244, 239, 230, 0.28)";
  ctx.lineWidth = 1;
  PRIORITY_FIELDS.forEach((field, index) => {
    const angle = priorityAngle(index);
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(center.x + Math.cos(angle) * maxRadius, center.y + Math.sin(angle) * maxRadius);
    ctx.stroke();

    const labelX = center.x + Math.cos(angle) * labelRadius;
    const labelY = center.y + Math.sin(angle) * labelRadius;
    ctx.fillStyle = "rgba(244, 239, 230, 0.92)";
    ctx.font = "700 14px sans-serif";
    ctx.textAlign = labelX < center.x - 8 ? "right" : labelX > center.x + 8 ? "left" : "center";
    ctx.textBaseline = labelY < center.y ? "bottom" : "top";
    ctx.fillText(field.label, labelX, labelY);
  });

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fillStyle = priorityHeatmapGradient(ctx, center, maxRadius);
  ctx.fill();
  ctx.strokeStyle = "#654bf2";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(244, 239, 230, 0.86)";
  ctx.beginPath();
  ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
  ctx.fill();

  points.forEach((point) => {
    ctx.fillStyle = priorityColor(point.level);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#101832";
    ctx.font = "800 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(point.level), point.x, point.y);
  });
}

function beginPriorityDrag(event) {
  priorityDragPointerId = event.pointerId;
  el.utilityChart.setPointerCapture(event.pointerId);
  updatePriorityFromPointer(event);
}

function movePriorityDrag(event) {
  if (priorityDragPointerId !== event.pointerId) return;
  updatePriorityFromPointer(event);
}

function endPriorityDrag(event) {
  if (priorityDragPointerId !== event.pointerId) return;
  priorityDragPointerId = null;
  if (el.utilityChart.hasPointerCapture(event.pointerId)) el.utilityChart.releasePointerCapture(event.pointerId);
}

function updatePriorityFromPointer(event) {
  const bundle = activeBundle();
  if (!bundle) return;
  const canvas = el.utilityChart;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const center = { x: canvas.width / 2, y: canvas.height / 2 };
  const maxRadius = Math.min(canvas.width, canvas.height) * 0.34;
  const dx = x - center.x;
  const dy = y - center.y;

  let closestIndex = 0;
  let closestDistance = Infinity;
  PRIORITY_FIELDS.forEach((_, index) => {
    const angle = priorityAngle(index);
    const distance = Math.abs(angularDistance(Math.atan2(dy, dx), angle));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  const angle = priorityAngle(closestIndex);
  const projected = Math.max(0, dx * Math.cos(angle) + dy * Math.sin(angle));
  const level = clampPriority(Math.round((projected / maxRadius) * PRIORITY_MAX));
  bundle.priority[PRIORITY_FIELDS[closestIndex].key] = level;
  touchBundle(bundle);
  saveState();
  renderBundleList();
  renderBuilderOnly();
}

function priorityPoints(bundle, center, maxRadius) {
  return PRIORITY_FIELDS.map((field, index) => {
    const level = priorityLevel(bundle, field.key);
    const angle = priorityAngle(index);
    const radius = (maxRadius * level) / PRIORITY_MAX;
    return {
      ...field,
      level,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

function priorityAngle(index) {
  return -Math.PI / 2 + (index * Math.PI * 2) / PRIORITY_FIELDS.length;
}

function angularDistance(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function priorityLevel(bundle, key) {
  bundle.priority ??= priorityDefaults(bundle.ownerRole);
  return clampPriority(Number(bundle.priority[key] ?? 3));
}

function priorityDefaults(role) {
  return {
    collateralAmount: 4,
    principal: 5,
    interestBps: 5,
    durationDays: 3,
    gracePeriodDays: 3,
  };
}

function priorityColor(level) {
  return {
    1: "#3b82f6",
    2: "#22c7a9",
    3: "#f2c94c",
    4: "#f2994a",
    5: "#ef4444",
  }[clampPriority(level)];
}

function priorityHeatmapGradient(ctx, center, maxRadius) {
  const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, maxRadius);
  gradient.addColorStop(0, hexToRgba(priorityColor(1), 0.28));
  gradient.addColorStop(0.25, hexToRgba(priorityColor(2), 0.28));
  gradient.addColorStop(0.5, hexToRgba(priorityColor(3), 0.3));
  gradient.addColorStop(0.75, hexToRgba(priorityColor(4), 0.32));
  gradient.addColorStop(1, hexToRgba(priorityColor(5), 0.34));
  return gradient;
}

function clampPriority(value) {
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Number.isFinite(value) ? value : 3));
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawMiniPriorityPolygon(canvas, bundle) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const center = { x: width / 2, y: height / 2 + 2 };
  const maxRadius = Math.min(width, height) * 0.36;
  const points = priorityPoints(bundle, center, maxRadius);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#dce2f0";
  ctx.lineWidth = 1;
  PRIORITY_FIELDS.forEach((_, index) => {
    const angle = priorityAngle(index);
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(center.x + Math.cos(angle) * maxRadius, center.y + Math.sin(angle) * maxRadius);
    ctx.stroke();
  });

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.strokeStyle = "#654bf2";
  ctx.lineWidth = 2;
  ctx.stroke();

  points.forEach((point) => {
    ctx.fillStyle = priorityColor(point.level);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function fieldValueText(key, value) {
  if (key === "principal") return Number(value).toLocaleString("en-US");
  if (key === "collateralTokenPrice") return formatTokenPrice(value);
  if (key === "interestBps") return `${Number(value).toFixed(1)}%`;
  return Number(value).toLocaleString("en-US");
}

function bundleDifferenceLines(bundle, topBundle) {
  if (!topBundle || bundle.bundleId === topBundle.bundleId) return ["Top bundle"];
  const differences = [
    termDifference("Collateral", bundle.collateralAmount.range.target, topBundle.collateralAmount.range.target, {
      more: "More Collateral",
      less: "Less Collateral",
    }),
    termDifference("Principal", bundle.principal.range.target, topBundle.principal.range.target, {
      more: "More Principal",
      less: "Less Principal",
    }),
    termDifference("Rate", bundle.interestBps.range.target, topBundle.interestBps.range.target, {
      more: "Higher Rate",
      less: "Lower Rate",
    }),
    termDifference("Duration", bundle.durationDays.range.target, topBundle.durationDays.range.target, {
      more: "Longer Duration",
      less: "Shorter Duration",
    }),
    termDifference("Grace", bundle.gracePeriodDays.range.target, topBundle.gracePeriodDays.range.target, {
      more: "More Grace",
      less: "Less Grace",
    }),
  ].filter(Boolean);
  differences.sort((a, b) => b.weight - a.weight);
  return differences.slice(0, 2).map((item) => item.label);
}

function termDifference(name, value, baseline, labels) {
  const delta = value - baseline;
  const denominator = Math.max(Math.abs(baseline), 1);
  const weight = Math.abs(delta) / denominator;
  if (name === "Rate" && Math.abs(delta) < 0.2) return null;
  if (name !== "Rate" && weight < 0.08) return null;
  return {
    label: delta > 0 ? labels.more : labels.less,
    weight,
  };
}

function createBundle(role) {
  const rank = sortedRoleBundles(role).length + 1;
  const bundle = makeBundle(role, rank, role === "borrower" ? `Borrower Region ${rank}` : `Lender Region ${rank}`);
  state.bundles.push(bundle);
  applySelectedCapitalToBundle(bundle);
  return bundle;
}

function makeBundle(role, rank, label, overrides = {}) {
  const isBorrower = role === "borrower";
  const bundle = {
    bundleId: `B-${String(state.nextBundleId++).padStart(4, "0")}`,
    ownerRole: role,
    rank,
    label,
    labelEdited: overrides.labelEdited ?? !isDefaultBundleLabel(label, role),
    assetClass: overrides.assetClass ?? "TokenOps Equity A",
    collateralToken: overrides.collateralToken ?? null,
    tokenOpsManager: overrides.tokenOpsManager ?? null,
    expiryDays: overrides.expiryDays ?? 30,
    active: true,
    principal: pref(
      overrides.principal ?? demoPrincipalPreset(role, rank),
      isBorrower ? "higher_is_better" : "target_is_best",
    ),
    collateralAmount: pref(
      overrides.collateralAmount ?? [100_000, 200_000, 150_000],
      isBorrower ? "lower_is_better" : "higher_is_better",
    ),
    interestBps: pref(overrides.interest ?? [5, 10, 7], isBorrower ? "lower_is_better" : "higher_is_better"),
    durationDays: pref(overrides.duration ?? [180, 720, 360], isBorrower ? "higher_is_better" : "lower_is_better"),
    gracePeriodDays: pref(overrides.grace ?? [0, 15, 7], isBorrower ? "higher_is_better" : "lower_is_better"),
    priority: overrides.priority ?? priorityDefaults(role),
    lastChangedAt: overrides.lastChangedAt ?? Date.now(),
    lastSavedAt: overrides.lastSavedAt ?? null,
  };
  updateAutoBundleLabel(bundle);
  return bundle;
}

function updateAutoBundleLabel(bundle) {
  if (bundle.labelEdited) return;
  bundle.label = classifyBundle(bundle);
}

function touchBundle(bundle) {
  if (!bundle) return;
  bundle.lastChangedAt = Date.now();
}

function markBundleSaved(bundle) {
  if (!bundle) return;
  const now = Date.now();
  bundle.lastChangedAt ??= now;
  bundle.lastSavedAt = now;
}

function bundleSaved(bundle) {
  return Boolean(bundle.lastSavedAt && bundle.lastSavedAt >= (bundle.lastChangedAt ?? 0));
}

function touchOrder(role) {
  state.orderSave ??= structuredClone(emptyState.orderSave);
  state.orderSave[role] ??= { changedAt: 0, savedAt: 0 };
  state.orderSave[role].changedAt = Date.now();
}

function markOrderSaved(role) {
  state.orderSave ??= structuredClone(emptyState.orderSave);
  state.orderSave[role] ??= { changedAt: 0, savedAt: 0 };
  const now = Date.now();
  state.orderSave[role].changedAt ||= now;
  state.orderSave[role].savedAt = now;
}

function orderSaved(role) {
  const status = state.orderSave?.[role];
  return Boolean(status?.savedAt && status.savedAt >= (status.changedAt ?? 0));
}

function isDefaultBundleLabel(label, role) {
  return new RegExp(`^${capitalize(role)} Region \\d+$`).test(label);
}

function isGeneratedBundleLabel(label, role) {
  return isDefaultBundleLabel(label, role) || GENERATED_BUNDLE_LABELS.has(label);
}

function classifyBundle(bundle) {
  const principal = bundle.principal.range.target;
  const interest = bundle.interestBps.range.target;
  const duration = bundle.durationDays.range.target;
  const price = impliedPricePreference(bundle).range.target;

  if (bundle.ownerRole === "borrower") {
    if (interest <= 6 && duration >= 540) return "Best Case";
    if (price <= 0.5 && interest <= 8) return "Capital Efficient";
    if (principal >= 120) return "Large Draw";
    if (duration <= 180) return "Short Bridge";
    if (interest >= 10) return "Fallback Terms";
    return "Balanced Borrow";
  }

  if (interest >= 11) return "Yield Seeking";
  if (price <= 0.6 && interest <= 9) return "Senior Supply";
  if (principal >= 120) return "Deep Liquidity";
  if (duration <= 270) return "Short Duration";
  if (price >= 0.7) return "Collateral Focused";
  return "Balanced Supply";
}

function demoPrincipalPreset(role, rank) {
  const presets = DEMO_PRINCIPAL_PRESETS[role] ?? DEMO_PRINCIPAL_PRESETS.borrower;
  return presets[Math.min(Math.max(rank, 1), presets.length) - 1];
}

function pref(values, direction, priority = "normal") {
  return {
    range: { min: values[0], max: values[1], target: values[2] },
    direction,
    priority,
  };
}

function seedDemoData() {
  state = structuredClone(emptyState);
  state.bundles = [
    makeBundle("borrower", 1, "Best Case", {
      labelEdited: false,
      principal: [50, 100, 100],
      collateralAmount: [100_000, 200_000, 150_000],
      interest: [5, 10, 7],
      duration: [180, 720, 360],
      grace: [0, 15, 7],
    }),
    makeBundle("borrower", 2, "Balanced", {
      labelEdited: false,
      principal: [50, 100, 75],
      collateralAmount: [100_000, 200_000, 150_000],
      interest: [6, 10, 7],
      duration: [180, 720, 360],
      grace: [0, 30, 14],
    }),
    makeBundle("borrower", 3, "Fallback", {
      labelEdited: false,
      principal: [25, 75, 50],
      collateralAmount: [100_000, 220_000, 175_000],
      interest: [8, 12, 9],
      duration: [90, 540, 270],
      grace: [0, 15, 7],
    }),
    makeBundle("lender", 1, "Senior Supply", {
      labelEdited: false,
      principal: [50, 100, 100],
      collateralAmount: [100_000, 200_000, 150_000],
      interest: [5, 10, 7],
      duration: [180, 720, 360],
      grace: [0, 15, 7],
    }),
    makeBundle("lender", 2, "Yield Seeking", {
      labelEdited: false,
      principal: [50, 150, 100],
      collateralAmount: [125_000, 225_000, 175_000],
      interest: [8, 13, 12],
      duration: [270, 720, 540],
      grace: [0, 21, 7],
    }),
  ];
  state.nextBundleId = 6;
  state.activeBundleId = state.bundles[0].bundleId;
  state.role = "borrower";
  state.matches = [];
  state.nextMatchId = 1;
  state.loans = [];
  state.nextLoanId = 1;
  state.activeLoanId = null;
  state.orderSave = {
    borrower: { changedAt: Date.now(), savedAt: 0 },
    lender: { changedAt: Date.now(), savedAt: 0 },
  };
  saveState();
}

function activeBundle() {
  return state.bundles.find((bundle) => bundle.bundleId === state.activeBundleId);
}

function ensureActiveBundle() {
  if (!state.activeBundleId || !activeBundle()) {
    state.activeBundleId = state.bundles[0]?.bundleId ?? createBundle(state.role).bundleId;
  }
  const active = activeBundle();
  if (active) state.role = active.ownerRole;
}

function sortedRoleBundles(role) {
  return state.bundles.filter((bundle) => bundle.ownerRole === role && bundle.active).sort((a, b) => a.rank - b.rank);
}

function reorderBundleToIndex(sourceId, targetIndex) {
  const source = state.bundles.find((bundle) => bundle.bundleId === sourceId);
  if (!source || targetIndex === null || targetIndex < 0) return;
  const bundles = sortedRoleBundles(source.ownerRole);
  const sourceIndex = bundles.findIndex((bundle) => bundle.bundleId === sourceId);
  if (sourceIndex < 0) return;
  const [moved] = bundles.splice(sourceIndex, 1);
  const insertionIndex = Math.min(targetIndex, bundles.length);
  bundles.splice(insertionIndex, 0, moved);
  bundles.forEach((bundle, index) => {
    bundle.rank = index + 1;
  });
}

function removeBundle(bundleId) {
  const bundle = state.bundles.find((candidate) => candidate.bundleId === bundleId);
  if (!bundle) return;
  const role = bundle.ownerRole;
  bundle.active = false;
  const nextBundle = sortedRoleBundles(role)[0] ?? createBundle(role);
  state.activeBundleId = nextBundle.bundleId;
  state.role = role;
  normalizeRanks(role);
  touchOrder(role);
  saveState();
  render();
  showToast(`${capitalize(role)} bundle removed from this browser.`, "good");
}

function normalizeRanks(role) {
  sortedRoleBundles(role).forEach((bundle, index) => {
    bundle.rank = index + 1;
  });
}

function normalizeField(field) {
  if (field.range.min > field.range.max) [field.range.min, field.range.max] = [field.range.max, field.range.min];
  field.range.target = Math.min(field.range.max, Math.max(field.range.min, field.range.target));
}

function groupBuckets(bundles) {
  const map = new Map();
  bundles.forEach((bundle) => {
    const bucketId = bucketFor(bundle);
    if (!map.has(bucketId)) {
      map.set(bucketId, {
        id: bucketId,
        side: bundle.ownerRole,
        assetClass: bundle.assetClass,
        principalBucket: contractPrincipalBucketLabel(bundle),
        durationBucket: contractDurationBucketLabel(bundle),
        count: 0,
        expiryDays: bundle.expiryDays,
      });
    }
    const bucket = map.get(bucketId);
    bucket.count += 1;
    bucket.expiryDays = Math.min(bucket.expiryDays, bundle.expiryDays);
  });
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function displayBuckets() {
  return contractState.discovery?.buckets ?? [];
}

function displayLoans() {
  const byKey = new Map();
  (contractState.discovery?.loans ?? []).forEach((loan) => {
    byKey.set(loanKey(loan), loan);
  });
  state.loans.forEach((localLoan, index) => {
    const key = loanKey(localLoan);
    const chainLoan = byKey.get(key);
    byKey.set(key, chainLoan ? mergeLoanViews(localLoan, chainLoan, index) : { ...localLoan, sortIndex: index });
  });
  return [...byKey.values()].sort((a, b) => {
    const blockDelta = Number(b.blockNumber ?? 0) - Number(a.blockNumber ?? 0);
    if (blockDelta !== 0) return blockDelta;
    return Number(a.sortIndex ?? 999_999) - Number(b.sortIndex ?? 999_999);
  });
}

function mergeLoanViews(localLoan, chainLoan, sortIndex) {
  return {
    ...chainLoan,
    ...localLoan,
    source: "chain+local",
    sourceLabel: "Sepolia + browser cache",
    status: chainLoan.status,
    statusClass: chainLoan.statusClass,
    collateralRegistered: chainLoan.collateralRegistered,
    fundingCredited: chainLoan.fundingCredited,
    repaymentCredited: chainLoan.repaymentCredited,
    pledgeId: chainLoan.pledgeId ?? localLoan.pledgeId,
    releaseRecipient: chainLoan.releaseRecipient ?? localLoan.releaseRecipient,
    releaseCompleted: chainLoan.releaseCompleted,
    dueTimestamp: chainLoan.dueTimestamp,
    gracePeriodSeconds: chainLoan.gracePeriodSeconds,
    activationDeadline: chainLoan.activationDeadline,
    indexedOnly: false,
    sortIndex,
    events: [...(chainLoan.events ?? []), ...(localLoan.events ?? [])],
  };
}

function loanKey(loan) {
  return String(loan?.loanId ?? loan?.escrowAddress ?? "").toLowerCase();
}

function bucketFor(bundle) {
  const principalBucket = contractPrincipalBucketLabel(bundle).toLowerCase();
  const durationBucket = contractDurationBucketLabel(bundle).toLowerCase();
  return `${bundle.ownerRole}:${bundle.assetClass}:${principalBucket}:${durationBucket}`.toLowerCase();
}

function impliedPricePreference(bundle) {
  const principal = bundle.principal.range;
  const collateral = bundle.collateralAmount.range;
  const min = principal.min / Math.max(1, collateral.max);
  const max = principal.max / Math.max(1, collateral.min);
  const target = principal.target / Math.max(1, collateral.target);
  return pref(
    [roundPrice(min), roundPrice(max), roundPrice(Math.min(max, Math.max(min, target)))],
    bundle.ownerRole === "borrower" ? "higher_is_better" : "lower_is_better",
  );
}

function roundPrice(value) {
  return Math.round(value * 10_000) / 10_000;
}

function termsHash(taker, maker, terms) {
  const raw = `${taker.bundleId}:${maker.bundleId}:${terms.principal}:${terms.collateralTokenPrice}:${terms.interest}:${terms.duration}:${terms.grace}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function directionButtons(fieldKey, selected) {
  const options = [
    ["higher_is_better", "⬆️", "Higher is better"],
    ["lower_is_better", "⬇️", "Lower is better"],
    ["target_is_best", "🎯", "Target is best"],
    ["neutral", "🤷", "Neutral"],
  ];
  return options
    .map(
      ([value, emoji, label]) => `
        <button
          class="direction-option ${value === selected ? "active" : ""}"
          type="button"
          data-field="${fieldKey}"
          data-value="${value}"
          aria-label="${label}"
          aria-pressed="${value === selected ? "true" : "false"}"
          data-tooltip="${label}"
          title="${label}"
        >${emoji}</button>
      `,
    )
    .join("");
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrateState(JSON.parse(raw)) : structuredClone(emptyState);
  } catch {
    return structuredClone(emptyState);
  }
}

function migrateState(candidate) {
  if (!candidate.bundles) return structuredClone(emptyState);
  const previousDemoValueScaleVersion = Number(candidate.demoValueScaleVersion ?? 0);
  const migrated = { ...structuredClone(emptyState), ...candidate };
  migrated.demoValueScaleVersion = previousDemoValueScaleVersion;
  migrated.loans ??= [];
  migrated.matches ??= [];
  migrated.orderSave = {
    ...structuredClone(emptyState.orderSave),
    ...(migrated.orderSave ?? {}),
  };
  migrated.appHelp = {
    ...structuredClone(emptyState.appHelp),
    ...(migrated.appHelp ?? {}),
  };
  migrated.demoUtils = {
    ...structuredClone(emptyState.demoUtils),
    ...(migrated.demoUtils ?? {}),
  };
  migrated.demoUtils.collateralAssets ??= [];
  migrated.demoUtils.collateralMetadata ??= {};
  migrated.demoUtils.borrowerCapital ??= [];
  migrated.demoUtils.lenderCapital ??= [];
  migrated.demoUtils.selectedBorrowerCapitalId ??= null;
  migrated.demoUtils.borrowerVestingAmount ??= null;
  migrated.demoUtils.borrowerTokenName = sanitizeTokenName(
    migrated.demoUtils.borrowerTokenName ?? emptyState.demoUtils.borrowerTokenName,
  );
  migrated.demoUtils.lenderEscrowAmount ??= null;
  if (migrated.demoUtils.borrowerPrep) {
    migrated.demoUtils.borrowerPrep.busy = false;
    migrated.demoUtils.borrowerPrep.currentStep = null;
    migrated.demoUtils.borrowerPrep.startedAt = null;
    migrated.demoUtils.borrowerPrep.runId = null;
    migrated.demoUtils.borrowerPrep.message = null;
  }
  if (migrated.demoUtils.lenderPrep) {
    migrated.demoUtils.lenderPrep.busy = false;
    migrated.demoUtils.lenderPrep.currentStep = null;
    migrated.demoUtils.lenderPrep.startedAt = null;
    migrated.demoUtils.lenderPrep.runId = null;
    migrated.demoUtils.lenderPrep.message = null;
  }
  migrated.nextLoanId ??= migrated.loans.length + 1;
  migrated.activeLoanId ??= migrated.loans[0]?.loanId ?? null;
  migrated.loans.forEach((loan) => {
    loan.statusClass ??= loan.status === "Defaulted" ? "lender" : loan.status === "Repaid" ? "borrower" : "";
    loan.events ??= [];
    loan.defaultWindowOpen ??= false;
    loan.activationDeadlinePassed ??= false;
    loan.contractBacked ??= false;
    loan.pledgeId ??= null;
    loan.releaseRecipient ??= null;
    loan.releaseCompleted ??= false;
    loan.creditToken ??= null;
    loan.terms ??= {
      principal: null,
      collateralTokenPrice: null,
      interest: null,
      duration: null,
      grace: null,
    };
    loan.terms.collateralTokenPrice ??= 0.75;
    loan.fundingCredited ??= Number(loan.funded ?? 0) >= Number(loan.terms?.principal ?? loan.principalAmount ?? 0);
    loan.repaymentCredited ??= Number(loan.paid ?? 0) >= Number(loan.totalDue ?? loan.totalDueAmount ?? 0);
    if (loan.contractBacked) {
      loan.fundingAuthorizationHash ??= localAuthorizationCommitment("funding", loan.matchId ?? loan.loanId);
      loan.fundingCommitmentHash ??= loan.fundingAuthorizationHash ?? null;
      loan.repaymentAuthorizationHash ??= localAuthorizationCommitment("repayment", loan.matchId ?? loan.loanId);
    }
  });
  migrated.bundles.forEach((bundle) => {
    bundle.collateralAmount ??= pref(
      bundle.ownerRole === "borrower" ? [100_000, 175_000, 135_000] : [100_000, 200_000, 150_000],
      bundle.ownerRole === "borrower" ? "lower_is_better" : "higher_is_better",
    );
    bundle.principal ??= pref(
      demoPrincipalPreset(bundle.ownerRole, bundle.rank ?? 1),
      bundle.ownerRole === "borrower" ? "higher_is_better" : "target_is_best",
    );
    bundle.labelEdited = bundle.labelEdited === true && !isGeneratedBundleLabel(bundle.label, bundle.ownerRole);
    bundle.assetClass ??= "TokenOps Equity A";
    bundle.collateralToken ??= null;
    bundle.tokenOpsManager ??= null;
    bundle.capitalRecordId ??= null;
    bundle.backingRegistered ??= false;
    bundle.activated ??= false;
    bundle.priority = { ...priorityDefaults(bundle.ownerRole), ...(bundle.priority ?? {}) };
    bundle.lastChangedAt ??= Date.now();
    bundle.lastSavedAt ??= null;
    PRIORITY_FIELDS.forEach(({ key }) => {
      bundle.priority[key] = priorityLevel(bundle, key);
    });
    updateAutoBundleLabel(bundle);
  });
  migrateScarceCreditDemoValues(migrated);
  migrated.matches.forEach((match) => {
    match.terms.collateralTokenPrice ??= 0.75;
    const taker = migrated.bundles.find((bundle) => bundle.bundleId === match.taker);
    const maker = migrated.bundles.find((bundle) => bundle.bundleId === match.maker);
    match.termsHash ??= taker && maker ? termsHash(taker, maker, match.terms) : "0x00000000";
    if (!match.contractExecution && match.contractStatus) {
      match.contractExecution = {
        status: match.contractStatus,
        message: match.contractFailure ?? "Previous contract execution",
        currentStep: null,
        completedSteps: [],
        ids: {
          bondAttemptId: match.contractBondAttemptId ?? null,
          matchAttemptId: match.contractMatchAttemptId ?? null,
        },
        error: match.contractFailure ?? null,
      };
    }
  });
  return migrated;
}

function migrateScarceCreditDemoValues(migrated) {
  if ((migrated.demoValueScaleVersion ?? 0) >= SCARCE_CREDIT_DEMO_VERSION) return;
  const migratedRoles = new Set();
  migrated.bundles.forEach((bundle) => {
    const principalTarget = Number(bundle.principal?.range?.target ?? 0);
    if (principalTarget < 10_000) return;
    if (bundle.contractPreferenceId || bundle.contractTxHash) return;
    if (!isGeneratedBundleLabel(bundle.label, bundle.ownerRole)) return;

    const [min, max, target] = demoPrincipalPreset(bundle.ownerRole, bundle.rank ?? 1);
    bundle.principal.range = { min, max, target };
    bundle.lastChangedAt = Date.now();
    bundle.lastSavedAt = null;
    updateAutoBundleLabel(bundle);
    migratedRoles.add(bundle.ownerRole);
  });

  if (migratedRoles.has("borrower")) migrated.demoUtils.borrowerPrep = null;
  if (migratedRoles.has("lender")) migrated.demoUtils.lenderPrep = null;
  migrated.demoValueScaleVersion = SCARCE_CREDIT_DEMO_VERSION;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableState()));
}

function persistableState() {
  const next = structuredClone(state);
  if (next.demoUtils?.borrowerPrep) {
    next.demoUtils.borrowerPrep.busy = false;
    next.demoUtils.borrowerPrep.currentStep = null;
    next.demoUtils.borrowerPrep.startedAt = null;
    next.demoUtils.borrowerPrep.runId = null;
    next.demoUtils.borrowerPrep.message = null;
  }
  if (next.demoUtils?.lenderPrep) {
    next.demoUtils.lenderPrep.busy = false;
    next.demoUtils.lenderPrep.currentStep = null;
    next.demoUtils.lenderPrep.startedAt = null;
    next.demoUtils.lenderPrep.runId = null;
    next.demoUtils.lenderPrep.message = null;
  }
  return next;
}

function showToast(message, tone = "good", durationMs = 2_800) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

function loanActionLabel(action) {
  return (
    {
      "register-collateral": "Register Collateral",
      fund: "Credit Funding",
      activate: "Activate",
      repay: "Repay In Full",
      "check-default": "Check Default",
      unwind: "Unwind",
      "complete-release": "Complete Release",
    }[action] ?? action
  );
}

function formatUsd(value) {
  return `$${Math.max(0, value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatEth(value) {
  if (typeof value === "bigint" && window.ethers?.formatEther) {
    return Number(window.ethers.formatEther(value)).toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  return Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatTokenPrice(value) {
  return `$${Math.max(0, Number(value)).toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function oppositeRole(role) {
  return role === "borrower" ? "lender" : "borrower";
}

function shortAddress(value) {
  const text = String(value);
  if (text.length <= 14) return text;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function shortHash(value) {
  const text = String(value);
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}…${text.slice(-6)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
