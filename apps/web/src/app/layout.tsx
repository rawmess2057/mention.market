import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { TopBar, BottomNav } from "@/components/shell";
import { TickerTape } from "@/components/viz/ticker-tape";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
// Market titles are quotes of things people might say, so they're set in an
// editorial serif: the one typographic voice the product owns.
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "mention.market — trade on what gets said",
  description:
    "Solana-native prediction markets on specific words and phrases spoken during live events.",
};

export const viewport: Viewport = {
  themeColor: "#0A0D13",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${mono.variable} ${display.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>
          <div className="backdrop" aria-hidden>
            <span className="backdrop-blob backdrop-blob-a" />
            <span className="backdrop-blob backdrop-blob-b" />
            <span className="backdrop-grid" />
            <span className="backdrop-noise" />
          </div>
          <TopBar />
          <TickerTape />
          <main className="mx-auto w-full max-w-7xl px-6 pb-28 pt-6 md:px-8 lg:px-12 md:pb-14 md:pt-7">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
