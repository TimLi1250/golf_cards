import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegistration from "../components/pwa-registration";

export const metadata: Metadata = {
  title: "Golf | Online Card Game",
  description: "Play four-card Golf with your group online.",
  applicationName: "Golf",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Golf",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0b2c24",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<PwaRegistration /></body>
    </html>
  );
}
