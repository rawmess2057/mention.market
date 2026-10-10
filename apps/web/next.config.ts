import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep dev and production build output separate so `next build` and
  // `next dev` can never clobber each other's chunks (they share `.next` by
  // default, which corrupts the server bundle and breaks pages).
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  webpack: (config) => {
    // Solana / web3.js packages rely on Node APIs in the browser
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
