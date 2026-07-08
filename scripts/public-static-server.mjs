import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const cacheDir = path.join(root, "cache");
const discoveryCachePath = process.env.CVC_DISCOVERY_CACHE_PATH ?? path.join(cacheDir, "discovery.json");
const host = process.env.CVC_STATIC_HOST ?? "0.0.0.0";
const port = Number(process.env.CVC_STATIC_PORT ?? "80");
const discoveryRpcUrl =
  process.env.CVC_DISCOVERY_RPC_URL ??
  (process.env.CVC_INFURA_API_KEY ? `https://sepolia.infura.io/v3/${process.env.CVC_INFURA_API_KEY}` : null);
const discoveryFallbackRpcUrls = (process.env.CVC_DISCOVERY_FALLBACK_RPC_URLS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const discoveryRpcUrls = [discoveryRpcUrl, ...discoveryFallbackRpcUrls].filter(Boolean);
const discoveryTtlMs = Number(process.env.CVC_DISCOVERY_TTL_MS ?? "5000");
const discoveryLookbackBlocks = Number(process.env.CVC_DISCOVERY_LOOKBACK_BLOCKS ?? "250000");
const discoveryChunkBlocks = Number(process.env.CVC_DISCOVERY_CHUNK_BLOCKS ?? "5000");
const discoveryFromBlock = process.env.CVC_DISCOVERY_FROM_BLOCK ? Number(process.env.CVC_DISCOVERY_FROM_BLOCK) : null;
const rateLimitWindowMs = Number(process.env.CVC_API_RATE_LIMIT_WINDOW_MS ?? "60000");
const rateLimitMax = Number(process.env.CVC_API_RATE_LIMIT_MAX ?? "90");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);
const noCacheExtensions = new Set([".html", ".js", ".json"]);
const apiRateLimits = new Map();
let rpcRequestId = 1;
let discoveryCache = readDiscoveryCache();
let discoveryRefresh = null;
let discoveryBackoffUntil = 0;
let discoveryBackoffMs = 0;

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const PREFERENCE_CREATED_TOPIC = "0x1fa04f9749bc7085f2ff516d8742c986fa059e8986f252678667a6944af0a70c";
const LOAN_CREATED_TOPIC = "0xf71254e06aa358e4384dc3f36fbe2ca594b015b2442658d1b04dc8b463a4e934";
const SELECTORS = {
  getPreferenceBundle: "0xd143f69f",
  borrower: "0x7df1f1b9",
  lender: "0xbcead63e",
  vestingAdapter: "0x0e4b64e7",
  creditAdapter: "0x46c5d3f5",
  tokenOpsManager: "0x9d8bebb2",
  vestingId: "0xd453bec6",
  dueTimestamp: "0x5451073d",
  gracePeriodSeconds: "0x9befb13b",
  activationDeadline: "0x66aaa05d",
  fundingCommitmentHash: "0x344ba621",
  fundingAuthorizationHash: "0x39096fba",
  repaymentAuthorizationHash: "0xc9ef7a94",
  encryptedTermsHash: "0xb0828dc0",
  state: "0xc19d93fb",
  pledgeId: "0x79b29a22",
  fundingCredited: "0x7c7382a4",
  repaymentCredited: "0x33e8d0f5",
  getPledge: "0xd01739cb",
};
const PREFERENCE_STATUS = {
  Executable: 5,
};
const LOAN_STATE = {
  0: "None",
  1: "AwaitingEscrow",
  2: "Active",
  3: "Repaid",
  4: "Defaulted",
  5: "Unwound",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/api/discovery") {
      await handleDiscoveryRequest(request, response);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "server error" });
  }
});

server.listen(port, host, () => {
  console.log(`CVC web UI listening on http://${host}:${port}`);
});

async function handleDiscoveryRequest(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
    return;
  }
  if (!allowApiRequest(request)) {
    sendJson(response, 429, { error: "rate limited" }, { "retry-after": "60" });
    return;
  }
  if (discoveryRpcUrls.length === 0) {
    sendJson(response, 503, { error: "server discovery rpc unavailable" });
    return;
  }

  try {
    const discovery = await discoveryData();
    sendJson(
      response,
      200,
      publicDiscoveryPayload(discovery),
      { "cache-control": "private, max-age=5" },
      request.method === "HEAD",
    );
  } catch (error) {
    console.warn("Discovery refresh failed:", error instanceof Error ? error.message : "unknown error");
    if (discoveryCache?.buckets) {
      sendJson(
        response,
        200,
        publicDiscoveryPayload(discoveryCache, {
          stale: true,
          status: "Stale server index",
          error: "server discovery refresh failed",
        }),
        { "cache-control": "private, max-age=5" },
        request.method === "HEAD",
      );
      return;
    }
    sendJson(response, 503, { error: "server discovery unavailable" });
  }
}

function allowApiRequest(request) {
  const key = clientAddress(request);
  const now = Date.now();
  const recent = (apiRateLimits.get(key) ?? []).filter((timestamp) => now - timestamp < rateLimitWindowMs);
  if (recent.length >= rateLimitMax) {
    apiRateLimits.set(key, recent);
    return false;
  }
  recent.push(now);
  apiRateLimits.set(key, recent);
  if (apiRateLimits.size > 2_000) {
    for (const [address, timestamps] of apiRateLimits.entries()) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] >= rateLimitWindowMs) {
        apiRateLimits.delete(address);
      }
    }
  }
  return true;
}

function clientAddress(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return request.socket.remoteAddress ?? "unknown";
}

async function serveStatic(urlPath, response) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = decoded === "/" ? "/index.html" : decoded;
  const target = path.normalize(path.join(publicDir, normalized));
  if (!target.startsWith(publicDir)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  const filePath = stat.isDirectory() ? path.join(target, "index.html") : target;
  const fileStat = fs.statSync(filePath);
  const extension = path.extname(filePath);
  const headers = {
    "content-type": contentTypes.get(extension) ?? "application/octet-stream",
    "content-length": fileStat.size,
    "x-content-type-options": "nosniff",
  };
  if (noCacheExtensions.has(extension)) {
    headers["cache-control"] = "no-store";
  }
  response.writeHead(200, {
    ...headers,
  });
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, status, payload, headers = {}, headOnly = false) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
    ...headers,
  });
  if (headOnly) {
    response.end();
    return;
  }
  response.end(body);
}

async function discoveryData() {
  const now = Date.now();
  const manifest = readManifest();
  const manifestKey = discoveryManifestKey(manifest);
  if (discoveryCache && discoveryCache.manifestKey !== manifestKey) {
    discoveryCache = null;
    discoveryBackoffUntil = 0;
    discoveryBackoffMs = 0;
  }

  if (discoveryCache && now - Number(discoveryCache.updatedAt ?? 0) < discoveryTtlMs) {
    return { ...discoveryCache, cacheAgeMs: now - Number(discoveryCache.updatedAt ?? now) };
  }
  if (discoveryCache && now < discoveryBackoffUntil) {
    return {
      ...discoveryCache,
      stale: true,
      status: "Rate limited; serving cached index",
      error: "server discovery temporarily rate limited",
      cacheAgeMs: now - Number(discoveryCache.updatedAt ?? now),
    };
  }
  if (!discoveryRefresh) {
    discoveryRefresh = refreshDiscovery()
      .then((discovery) => {
        discoveryBackoffUntil = 0;
        discoveryBackoffMs = 0;
        return discovery;
      })
      .catch((error) => {
        registerDiscoveryFailure(error);
        throw error;
      })
      .finally(() => {
        discoveryRefresh = null;
      });
  }
  return discoveryRefresh;
}

function registerDiscoveryFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.includes("429") && !message.toLowerCase().includes("too many")) return;
  discoveryBackoffMs = Math.min(discoveryBackoffMs ? discoveryBackoffMs * 2 : 30_000, 300_000);
  discoveryBackoffUntil = Date.now() + discoveryBackoffMs;
}

async function refreshDiscovery() {
  const manifest = readManifest();
  const manifestKey = discoveryManifestKey(manifest);
  const latest = Number.parseInt(await rpc("eth_blockNumber", []), 16);
  const baselineFrom = Math.max(0, discoveryFromBlock ?? latest - discoveryLookbackBlocks);
  const previous = normalizeDiscoveryCache(
    discoveryCache?.manifestKey === manifestKey ? discoveryCache : null,
    baselineFrom,
  );
  const hasIncrementalState =
    Array.isArray(previous.indexedPreferenceEvents) && Array.isArray(previous.indexedLoanEvents);
  const fromBlock = hasIncrementalState
    ? Math.max(baselineFrom, Number(previous.scannedTo ?? baselineFrom) + 1)
    : baselineFrom;
  const scannedTo = latest;
  const bookAddress = manifest.contracts?.ConfidentialPreferenceBook?.address;
  const factoryAddress = manifest.contracts?.LoanEscrowFactory?.address;
  if (!bookAddress || !factoryAddress) {
    throw new Error("manifest missing discovery contracts");
  }

  if (hasIncrementalState && scannedTo < fromBlock) {
    const preferences = activeCachedPreferences(previous.preferences);
    const loans = previous.loans ?? [];
    const refreshed = {
      ...previous,
      manifestKey,
      status: `Indexed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      updatedAt: Date.now(),
      scannedFrom: baselineFrom,
      scannedTo,
      error: null,
      preferences,
      buckets: bucketsFromLivePreferences(preferences, manifest),
      preferenceById: Object.fromEntries(
        preferences.map((preference) => [preference.preferenceId.toLowerCase(), preference]),
      ),
      loans,
      loanById: Object.fromEntries(loans.map((loan) => [loan.loanId.toLowerCase(), loan])),
    };
    discoveryCache = refreshed;
    writeDiscoveryCache(refreshed);
    return { ...refreshed, cacheAgeMs: 0 };
  }

  const [newBookLogs, newLoanFactoryLogs] =
    fromBlock <= scannedTo
      ? await Promise.all([
          getLogsChunked({
            address: bookAddress,
            fromBlock,
            toBlock: scannedTo,
          }),
          getLogsChunked({
            address: factoryAddress,
            fromBlock,
            toBlock: scannedTo,
          }),
        ])
      : [[], []];
  const preferenceEvents = mergePreferenceEvents(
    previous.indexedPreferenceEvents,
    newBookLogs
      .filter((log) => normalizeTopic(log.topics?.[0]) === PREFERENCE_CREATED_TOPIC)
      .map(parsePreferenceCreatedLog)
      .filter(Boolean),
  );
  const preferences =
    !hasIncrementalState || newBookLogs.length > 0
      ? (await Promise.all(preferenceEvents.map((event) => executablePreferenceFromEvent(bookAddress, event)))).filter(
          Boolean,
        )
      : activeCachedPreferences(previous.preferences);

  const loanEvents = mergeLoanEvents(
    previous.indexedLoanEvents,
    newLoanFactoryLogs
      .filter((log) => normalizeTopic(log.topics?.[0]) === LOAN_CREATED_TOPIC)
      .map(parseLoanCreatedLog)
      .filter(Boolean),
  );
  const newEscrowLogs =
    hasIncrementalState && previous.indexedLoanEvents?.length && fromBlock <= scannedTo
      ? await getLogsChunked({
          address: previous.indexedLoanEvents.map((event) => event.escrowAddress),
          fromBlock,
          toBlock: scannedTo,
        })
      : [];
  const loans =
    !hasIncrementalState || newLoanFactoryLogs.length > 0 || newEscrowLogs.length > 0
      ? (await Promise.all(loanEvents.map((event) => indexedLoanFromEvent(event)))).filter(Boolean)
      : (previous.loans ?? []);

  const updatedAt = Date.now();
  const discovery = {
    source: "server-indexer",
    indexStrategy: "incremental-block-catchup",
    manifestKey,
    status: `Indexed ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    updatedAt,
    scannedFrom: baselineFrom,
    scannedTo,
    error: null,
    indexedPreferenceEvents: preferenceEvents,
    indexedLoanEvents: loanEvents,
    preferences,
    buckets: bucketsFromLivePreferences(preferences, manifest),
    preferenceById: Object.fromEntries(
      preferences.map((preference) => [preference.preferenceId.toLowerCase(), preference]),
    ),
    loans,
    loanById: Object.fromEntries(loans.map((loan) => [loan.loanId.toLowerCase(), loan])),
  };
  discoveryCache = discovery;
  writeDiscoveryCache(discovery);
  return { ...discovery, cacheAgeMs: 0 };
}

function normalizeDiscoveryCache(cache, fallbackScannedFrom) {
  if (!cache) {
    return {
      scannedFrom: fallbackScannedFrom,
      scannedTo: fallbackScannedFrom - 1,
      indexedPreferenceEvents: [],
      indexedLoanEvents: [],
    };
  }
  return {
    ...cache,
    scannedFrom: Number(cache.scannedFrom ?? fallbackScannedFrom),
    scannedTo: Number(cache.scannedTo ?? fallbackScannedFrom - 1),
    indexedPreferenceEvents: Array.isArray(cache.indexedPreferenceEvents) ? cache.indexedPreferenceEvents : null,
    indexedLoanEvents: Array.isArray(cache.indexedLoanEvents) ? cache.indexedLoanEvents : null,
  };
}

function mergePreferenceEvents(previousEvents, newEvents) {
  return [
    ...new Map(
      [...(previousEvents ?? []), ...newEvents].map((event) => [event.preferenceId.toLowerCase(), event]),
    ).values(),
  ].sort((a, b) => Number(a.blockNumber ?? 0) - Number(b.blockNumber ?? 0));
}

function mergeLoanEvents(previousEvents, newEvents) {
  return [
    ...new Map([...(previousEvents ?? []), ...newEvents].map((event) => [event.loanId.toLowerCase(), event])).values(),
  ].sort((a, b) => Number(a.blockNumber ?? 0) - Number(b.blockNumber ?? 0));
}

function activeCachedPreferences(preferences = []) {
  const now = Math.floor(Date.now() / 1000);
  return preferences.filter((preference) => Number(preference.expiry ?? 0) > now);
}

function publicDiscoveryPayload(discovery, overrides = {}) {
  const {
    indexedPreferenceEvents: _indexedPreferenceEvents,
    indexedLoanEvents: _indexedLoanEvents,
    ...payload
  } = discovery ?? {};
  return {
    ...payload,
    cacheAgeMs: Date.now() - Number(payload.updatedAt ?? Date.now()),
    ...overrides,
  };
}

async function getLogsChunked(filter) {
  const logs = [];
  for (let start = Number(filter.fromBlock); start <= Number(filter.toBlock); start += discoveryChunkBlocks + 1) {
    const end = Math.min(Number(filter.toBlock), start + discoveryChunkBlocks);
    logs.push(
      ...(await rpc("eth_getLogs", [
        {
          address: filter.address,
          topics: filter.topics,
          fromBlock: toQuantity(start),
          toBlock: toQuantity(end),
        },
      ])),
    );
  }
  return logs;
}

function normalizeTopic(topic) {
  return typeof topic === "string" ? topic.toLowerCase() : null;
}

async function executablePreferenceFromEvent(bookAddress, event) {
  try {
    const preference = decodePreferenceBundle(
      await ethCall(bookAddress, `${SELECTORS.getPreferenceBundle}${strip0x(event.preferenceId)}`),
    );
    const expiry = Number(preference.metadata.expiry);
    if (preference.status !== PREFERENCE_STATUS.Executable || expiry <= Math.floor(Date.now() / 1000)) return null;

    return {
      preferenceId: event.preferenceId,
      manager: preference.manager,
      backingId: preference.backingId,
      status: preference.status,
      side: preference.metadata.side === 0 ? "borrower" : "lender",
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

function bucketsFromLivePreferences(preferences, manifest) {
  const map = new Map();
  preferences.forEach((preference) => {
    const id = `${preference.side}:${preference.bucketKey}`;
    if (!map.has(id)) {
      map.set(id, {
        id,
        source: "chain",
        sourceLabel: "Sepolia executable",
        side: preference.side,
        assetClass: collateralName(preference.collateralToken, preference.tokenOpsManager, manifest),
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
      Math.max(0, Math.ceil((preference.expiry - Math.floor(Date.now() / 1000)) / 86_400)),
    );
  });

  return [...map.values()]
    .map((bucket) => ({
      ...bucket,
      expiryDays: Number.isFinite(bucket.expiryDays) ? bucket.expiryDays : 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function indexedLoanFromEvent(event) {
  if (!event) return null;
  try {
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
      callAddress(event.escrowAddress, SELECTORS.borrower),
      callAddress(event.escrowAddress, SELECTORS.lender),
      callAddress(event.escrowAddress, SELECTORS.vestingAdapter),
      callAddress(event.escrowAddress, SELECTORS.creditAdapter),
      callAddress(event.escrowAddress, SELECTORS.tokenOpsManager),
      callBytes32(event.escrowAddress, SELECTORS.vestingId),
      callNumber(event.escrowAddress, SELECTORS.dueTimestamp),
      callNumber(event.escrowAddress, SELECTORS.gracePeriodSeconds),
      callNumber(event.escrowAddress, SELECTORS.activationDeadline),
      callBytes32(event.escrowAddress, SELECTORS.fundingCommitmentHash),
      callBytes32(event.escrowAddress, SELECTORS.fundingAuthorizationHash),
      callBytes32(event.escrowAddress, SELECTORS.repaymentAuthorizationHash),
      callBytes32(event.escrowAddress, SELECTORS.encryptedTermsHash),
      callNumber(event.escrowAddress, SELECTORS.state),
      callBytes32(event.escrowAddress, SELECTORS.pledgeId),
      callBool(event.escrowAddress, SELECTORS.fundingCredited),
      callBool(event.escrowAddress, SELECTORS.repaymentCredited),
    ]);
    const pledge = await indexedPledgeState(vestingAdapter, pledgeId);
    const status = LOAN_STATE[stateValue] ?? `State ${stateValue}`;
    return {
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
      collateralRegistered: pledgeId !== ZERO_BYTES32,
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
        grace: Math.round(gracePeriodSeconds / 86_400),
      },
      principalAmount: null,
      totalDue: null,
      totalDueAmount: null,
      dueDays: Math.max(0, Math.ceil((dueTimestamp - Math.floor(Date.now() / 1000)) / 86_400)),
      dueTimestamp,
      gracePeriodSeconds,
      activationDeadline,
      fundingCommitmentHash,
      fundingAuthorizationHash,
      repaymentAuthorizationHash,
      fundingDeadline: null,
      vestingAdapter,
      vestingId,
      tokenOpsManager,
      creditAdapter,
      creditToken: null,
      pledgeId: pledgeId === ZERO_BYTES32 ? null : pledgeId,
      pledgeStatus: pledge.status,
      releaseRecipient: pledge.releaseRecipient,
      releaseCompleted: pledge.releaseCompleted,
      targetBucketId: null,
      events: indexedLoanEvents({ blockNumber: event.blockNumber, status, pledge, fundingCredited, repaymentCredited }),
    };
  } catch {
    return null;
  }
}

async function indexedPledgeState(vestingAdapter, pledgeId) {
  if (!pledgeId || pledgeId === ZERO_BYTES32) {
    return { status: "None", releaseRecipient: null, releaseCompleted: false };
  }
  try {
    const pledge = decodePledge(await ethCall(vestingAdapter, `${SELECTORS.getPledge}${strip0x(pledgeId)}`));
    return {
      status: ["None", "Pledged", "ReleasePending", "Released"][pledge.status] ?? `Status ${pledge.status}`,
      releaseRecipient: pledge.status >= 2 ? pledge.releasedTo : null,
      releaseCompleted: pledge.status === 3,
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

function chainEventLine(blockNumber, text) {
  return {
    at: `block ${blockNumber}`,
    text,
  };
}

function loanStatusClass(status) {
  if (status === "Defaulted") return "lender";
  if (status === "Repaid" || status === "Unwound") return "borrower";
  return "";
}

function parsePreferenceCreatedLog(log) {
  if (!Array.isArray(log.topics) || log.topics.length < 4) return null;
  const words = dataWords(log.data);
  if (words.length < 5) return null;
  return {
    preferenceId: normalizeBytes32(log.topics[1]),
    side: Number(wordToBigInt(log.topics[2])),
    bucketKey: normalizeBytes32(log.topics[3]),
    collateralToken: wordToAddress(words[0]),
    tokenOpsManager: wordToAddress(words[1]),
    principalBucket: normalizeBytes32(words[2]),
    durationBucket: normalizeBytes32(words[3]),
    expiry: Number(wordToBigInt(words[4])),
    blockNumber: Number.parseInt(log.blockNumber, 16),
  };
}

function parseLoanCreatedLog(log) {
  if (!Array.isArray(log.topics) || log.topics.length < 4) return null;
  return {
    loanId: normalizeBytes32(log.topics[1]),
    escrowAddress: wordToAddress(log.topics[2]),
    termsHash: normalizeBytes32(log.topics[3]),
    blockNumber: Number.parseInt(log.blockNumber, 16),
  };
}

function decodePreferenceBundle(data) {
  const words = dataWords(data);
  if (words.length < 42) throw new Error("short preference response");
  return {
    manager: wordToAddress(words[0]),
    metadata: {
      side: Number(wordToBigInt(words[1])),
      collateralToken: wordToAddress(words[2]),
      tokenOpsManager: wordToAddress(words[3]),
      principalBucket: normalizeBytes32(words[4]),
      durationBucket: normalizeBytes32(words[5]),
      expiry: wordToBigInt(words[6]),
    },
    backingId: normalizeBytes32(words[7]),
    status: Number(wordToBigInt(words[8])),
  };
}

function decodePledge(data) {
  const words = dataWords(data);
  if (words.length < 6) throw new Error("short pledge response");
  return {
    manager: wordToAddress(words[0]),
    vestingId: normalizeBytes32(words[1]),
    borrower: wordToAddress(words[2]),
    loanEscrow: wordToAddress(words[3]),
    releasedTo: wordToAddress(words[4]),
    status: Number(wordToBigInt(words[5])),
  };
}

async function callAddress(to, selector) {
  return wordToAddress(await ethCall(to, selector));
}

async function callBytes32(to, selector) {
  return normalizeBytes32(await ethCall(to, selector));
}

async function callNumber(to, selector) {
  return Number(wordToBigInt(await ethCall(to, selector)));
}

async function callBool(to, selector) {
  return wordToBigInt(await ethCall(to, selector)) !== 0n;
}

async function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

async function rpc(method, params) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: rpcRequestId++,
    method,
    params,
  });
  let lastError = null;
  for (const endpoint of discoveryRpcUrls) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!response.ok) throw new Error(`rpc ${method} http ${response.status}`);
      const payload = await response.json();
      if (payload.error) {
        throw new Error(`rpc ${method} failed ${payload.error.code ?? ""} ${payload.error.message ?? ""}`.trim());
      }
      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`rpc ${method} failed`);
}

function dataWords(data) {
  const hex = strip0x(data);
  const words = [];
  for (let index = 0; index < hex.length; index += 64) {
    words.push(`0x${hex.slice(index, index + 64).padStart(64, "0")}`);
  }
  return words;
}

function wordToBigInt(word) {
  return BigInt(normalizeBytes32(word));
}

function wordToAddress(word) {
  return `0x${strip0x(word).slice(-40)}`.toLowerCase();
}

function normalizeBytes32(value) {
  return `0x${strip0x(value).padStart(64, "0").slice(-64)}`.toLowerCase();
}

function strip0x(value) {
  return String(value ?? "").replace(/^0x/i, "");
}

function toQuantity(value) {
  return `0x${Number(value).toString(16)}`;
}

function bytes32Label(value) {
  try {
    const bytes = Buffer.from(strip0x(value), "hex");
    const end = bytes.indexOf(0);
    const label = bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
    return label || value;
  } catch {
    return value;
  }
}

function collateralName(collateralToken, tokenOpsManager, manifest) {
  const assets = manifest.assets ?? {};
  if (equalAddress(collateralToken, assets.collateralToken) && equalAddress(tokenOpsManager, assets.tokenOpsManager)) {
    return "Manifest collateral";
  }
  return `${shortAddress(collateralToken)} / ${shortAddress(tokenOpsManager)}`;
}

function equalAddress(left, right) {
  return Boolean(left && right && String(left).toLowerCase() === String(right).toLowerCase());
}

function shortAddress(value) {
  if (!value) return "n/a";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(publicDir, "deployment-manifest.json"), "utf8"));
}

function discoveryManifestKey(manifest) {
  const contracts = manifest.contracts ?? {};
  const assets = manifest.assets ?? {};
  return [
    manifest.chainId,
    contracts.ConfidentialPreferenceBook?.address,
    contracts.LoanEscrowFactory?.address,
    contracts.MatchSettlementCoordinator?.address,
    contracts.NashNegotiationEngine?.address,
    contracts.ERC7984CreditAdapter?.address,
    assets.confidentialCreditToken,
    assets.collateralToken,
    assets.tokenOpsManager,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join("|");
}

function readDiscoveryCache() {
  try {
    return JSON.parse(fs.readFileSync(discoveryCachePath, "utf8"));
  } catch {
    return null;
  }
}

function writeDiscoveryCache(discovery) {
  try {
    fs.mkdirSync(path.dirname(discoveryCachePath), { recursive: true });
    fs.writeFileSync(discoveryCachePath, `${JSON.stringify(discovery, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Cache persistence is best-effort; the in-memory cache still serves this process.
  }
}
