import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is fully dynamic and authenticated, so Cache Components stays off.
  serverExternalPackages: ["sharp"],
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
