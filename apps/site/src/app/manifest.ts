import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Discount House",
    short_name: "TDH",
    description: "Borrow and lend against vesting tokens, privately.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f1ea",
    theme_color: "#0d0d0d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
