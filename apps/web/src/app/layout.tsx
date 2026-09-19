import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { TopBar, BottomNav } from "@/components/shell";
import { TickerTape } from "@/components/viz/ticker-tape";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "mention.market — trade on what gets said",
  description:
    "Solana-native prediction markets on specific words and phrases spoken during live events.",
};

export const viewport: Viewport = {
  themeColor: "#F9F7F4",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>
          <div className="grid-backdrop" aria-hidden />
          <TopBar />
          <TickerTape />
          <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 md:pb-12">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
