import type { Metadata } from "next";
import { Caveat, Patrick_Hand, Kalam } from "next/font/google";

import "./globals.css";

const description = "Five playful ways to draw with an AI: party rounds, a daily gauntlet, telephone chains, model-hacking puzzles, and a creative gallery.";
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const caveat = Caveat({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const patrickHand = Patrick_Hand({
  variable: "--font-body",
  subsets: ["latin"],
  weight: "400",
});

const kalam = Kalam({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Draw Battle!",
  title: {
    default: "Draw Battle!",
    template: "%s | Draw Battle!",
  },
  description,
  keywords: ["drawing game", "quick draw", "multiplayer drawing", "daily drawing", "AI sketch recognition"],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
  },
  openGraph: {
    type: "website",
    siteName: "Draw Battle!",
    title: "Draw Battle!",
    description,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Draw Battle! Five playful ways to draw with AI.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Draw Battle!",
    description,
    images: ["/twitter-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${caveat.variable} ${patrickHand.variable} ${kalam.variable}`}>{children}</body>
    </html>
  );
}
