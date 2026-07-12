import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CardPit",
    short_name: "CardPit",
    description: "Mobiele POS voor TCG-handelaren op beurzen",
    start_url: "/zoeken",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0C0B09",
    theme_color: "#0C0B09",
    lang: "nl",
    categories: ["business", "utilities"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
