import path from "node:path";
import type { NextConfig } from "next";

// TeaTrail is a client-side wallet dApp, so the template's
// Cache Components / Partial Prefetching features are switched off.
const nextConfig: NextConfig = {
  // Let phones on the same Wi-Fi open the dev server (for QR scan testing).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  turbopack: {
    // app/ is the project root.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;