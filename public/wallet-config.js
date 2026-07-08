window.CVC_WALLET_CONFIG = {
  metamask: {
    enabled: true,
    dapp: {
      name: "Confidential Vesting Credit",
      url: window.location.origin,
      iconUrl: "",
    },
    chainIds: ["0xaa36a7"],
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
