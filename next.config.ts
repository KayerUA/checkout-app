import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": [
      "./assets/fonts/**/*",
      "./node_modules/pdfkit/js/data/**/*",
    ],
  },
};

export default nextConfig;
