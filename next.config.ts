import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Three.js ecosystem packages ship modern ESM; transpile for consistent builds.
  transpilePackages: ["three"],
  // The GRACE/GRACE-FO extract is read from disk by the Water & Energy page on the server.
  outputFileTracingIncludes: { "/fields/[fieldId]/water": ["./data/reference/grace-mascon.json"], "/example": ["./data/example/rajshahi.json"] },
};

export default nextConfig;
