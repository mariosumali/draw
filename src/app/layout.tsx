import type { Metadata } from "next";
import { Caveat, Patrick_Hand, Kalam } from "next/font/google";

import "./globals.css";

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
  title: "Draw Battle!",
  description: "Grab a pencil and race your friend to doodle AI-recognized sketches!",
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
