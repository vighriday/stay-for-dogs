import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stay ships no generated agent instruction files.
  agentRules: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The microphone is the whole product; everything else stays off.
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
          },
        ],
      },
      {
        // The worklet is fetched by addModule and must not be stale after a deploy.
        source: "/stay-detector.worklet.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
