import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Golf — Four Card",
    short_name: "Golf",
    description: "Play four-card Golf with your group online.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b2c24",
    theme_color: "#0b2c24",
    orientation: "any",
    icons: [
      { src: "/golf-app-icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/golf-app-icon.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
    ],
  };
}
