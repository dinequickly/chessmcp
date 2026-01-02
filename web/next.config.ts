import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  /* config options here */
  reactCompiler: true,
  // Disable image optimization since we are doing a static export
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
