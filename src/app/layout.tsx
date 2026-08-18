import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegistration from "../components/pwa-registration";
import ScrollReset from "../components/scroll-reset";

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
  icons: {
    icon: [{ url: "/golf-app-icon.png", type: "image/png", sizes: "1024x1024" }],
    apple: [{ url: "/golf-app-icon.png", type: "image/png", sizes: "1024x1024" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b2c24",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<PwaRegistration /><ScrollReset /></body>
    </html>
  );
}
