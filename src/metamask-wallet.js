import { createEVMClient } from "@metamask/connect-evm";

const SEPOLIA_CHAIN_ID = "0xaa36a7";
const DEFAULT_CONNECT_TIMEOUT_MS = 120_000;
const DEFAULT_CONFIG = {
  metamask: {
    enabled: true,
    dapp: {
      name: "Confidential Vesting Credit",
      url: typeof window !== "undefined" ? window.location.origin : "https://example.com",
      iconUrl: "",
    },
    chainIds: [SEPOLIA_CHAIN_ID],
    supportedNetworks: {
      "0xaa36a7": "https://ethereum-sepolia-rpc.publicnode.com",
      "0x1": "https://ethereum-rpc.publicnode.com",
    },
    preferExtension: true,
    showInstallModal: false,
    useDeeplink: true,
    mobileDeeplinkBypass: true,
    debug: false,
  },
};

let client = null;
let clientKey = "";
let creatingClient = null;
let lastOpenedDeeplink = "";

function walletConfig() {
  const configured = window.CVC_WALLET_CONFIG?.metamask ?? {};
  return {
    ...DEFAULT_CONFIG.metamask,
    ...configured,
    dapp: {
      ...DEFAULT_CONFIG.metamask.dapp,
      ...(configured.dapp ?? {}),
      url: configured.dapp?.url || window.location.origin,
    },
    chainIds: configured.chainIds?.length ? configured.chainIds : DEFAULT_CONFIG.metamask.chainIds,
    supportedNetworks: {
      ...DEFAULT_CONFIG.metamask.supportedNetworks,
      ...(configured.supportedNetworks ?? {}),
    },
  };
}

function configKey(config) {
  return JSON.stringify({
    dapp: config.dapp,
    chainIds: config.chainIds,
    supportedNetworks: config.supportedNetworks,
    preferExtension: config.preferExtension,
    showInstallModal: config.showInstallModal,
    useDeeplink: config.useDeeplink,
    mobileDeeplinkBypass: config.mobileDeeplinkBypass,
    debug: config.debug,
  });
}

function isConfigured() {
  const config = walletConfig();
  return Boolean(config.enabled && config.chainIds?.length && Object.keys(config.supportedNetworks ?? {}).length);
}

async function ensureClient() {
  const config = walletConfig();
  if (!isConfigured()) return null;

  const nextKey = configKey(config);
  if (client && clientKey === nextKey) return client;
  if (creatingClient && clientKey === nextKey) return await creatingClient;

  const bypassSdkModal = shouldBypassSdkModal(config);
  clientKey = nextKey;
  creatingClient = createEVMClient({
    dapp: {
      name: config.dapp.name,
      url: config.dapp.url,
      ...(config.dapp.iconUrl ? { iconUrl: config.dapp.iconUrl } : {}),
    },
    api: {
      supportedNetworks: config.supportedNetworks,
    },
    analytics: {
      enabled: false,
      integrationType: "cvc-static",
    },
    ui: {
      headless: bypassSdkModal,
      preferExtension: config.preferExtension,
      showInstallModal: config.showInstallModal,
    },
    mobile: {
      useDeeplink: config.useDeeplink,
      preferredOpenLink: (deeplink) => {
        openMetaMaskLink(deeplink);
      },
    },
    eventHandlers: {
      connect: emitWalletChange,
      disconnect: () => emitWalletChange(null),
      accountsChanged: (accounts) => emitWalletChange(accounts?.length ? undefined : null),
      chainChanged: emitWalletChange,
      displayUri: (uri) => {
        window.dispatchEvent(new CustomEvent("cvc:wallet-display-uri", { detail: { uri } }));
        if (bypassSdkModal) openMetaMaskLink(uri);
      },
    },
    debug: config.debug,
  });

  try {
    client = await creatingClient;
    return client;
  } finally {
    creatingClient = null;
  }
}

async function connect(options = {}) {
  const settings = {
    requestAccounts: true,
    timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
    ...options,
  };
  const evmClient = await ensureClient();
  if (!evmClient) return { status: "unconfigured" };

  const existing = readConnection(evmClient);
  if (existing && !settings.forceRequest) return { status: "connected", ...existing };

  if (!settings.requestAccounts) {
    return { status: "not_connected" };
  }

  const config = walletConfig();
  const connected = await withTimeout(
    evmClient.connect({
      chainIds: config.chainIds,
      forceRequest: Boolean(settings.forceRequest),
    }),
    settings.timeoutMs,
  );
  if (!connected?.accounts?.length) return { status: "not_connected" };
  emitWalletChange();
  return {
    status: "connected",
    provider: evmClient.getProvider(),
    address: connected.accounts[0],
    chainId: connected.chainId,
    providerType: "metamask-connect",
  };
}

async function getConnection() {
  const evmClient = await ensureClient();
  if (!evmClient) return null;
  return readConnection(evmClient);
}

async function disconnect() {
  const evmClient = await ensureClient();
  if (!evmClient) return;
  await evmClient.disconnect();
  emitWalletChange(null);
}

function readConnection(evmClient) {
  const provider = evmClient.getProvider();
  const address =
    evmClient.getAccount?.() ?? evmClient.selectedAccount ?? evmClient.accounts?.[0] ?? provider.selectedAccount;
  const chainId = evmClient.getChainId?.() ?? evmClient.selectedChainId ?? provider.chainId;
  if (!provider || !address) return null;
  return {
    provider,
    address,
    chainId: chainId ? String(chainId) : null,
    providerType: "metamask-connect",
  };
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("MetaMask connection timed out.")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function shouldBypassSdkModal(config) {
  return Boolean(config.mobileDeeplinkBypass && isLikelyMobileWalletBrowser());
}

function isLikelyMobileWalletBrowser() {
  const nav = window.navigator;
  const userAgent = nav.userAgent || "";
  const touchMac = /Macintosh/i.test(userAgent) && Number(nav.maxTouchPoints ?? 0) > 1;
  return /iPad|iPhone|iPod|Android/i.test(userAgent) || touchMac;
}

function openMetaMaskLink(uri) {
  if (!uri || uri === lastOpenedDeeplink) return;
  lastOpenedDeeplink = uri;
  const link = document.createElement("a");
  link.href = uri;
  link.target = "_self";
  link.rel = "noreferrer noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function emitWalletChange(value) {
  window.dispatchEvent(
    new CustomEvent("cvc:wallet-change", {
      detail: value === null ? null : readConnection(client),
    }),
  );
}

window.CVCMetaMaskWallet = {
  connect,
  disconnect,
  getConnection,
  isConfigured,
};
