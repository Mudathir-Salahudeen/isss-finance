import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "exceljs", "pdf-lib", "@pdf-lib/fontkit", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // PDF fonts and the bundled logo are read from disk at runtime: make sure they ship with the serverless functions.
  outputFileTracingIncludes: { "/**": ["./assets/**/*"] },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};

export default nextConfig;
