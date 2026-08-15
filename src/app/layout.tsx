import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fairway Four | Online Golf Card Game",
  description: "A private table for four-card Golf.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
