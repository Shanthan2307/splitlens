import type { MetadataRoute } from "next";

/** "Add to Home screen" / install on Android: opens full-screen without browser chrome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SplitLens",
    short_name: "SplitLens",
    description: "Split expenses with friends and groups",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
