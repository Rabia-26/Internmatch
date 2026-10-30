/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Native modules and large server-only deps must not be bundled by Turbopack/webpack;
  // they need to be required at runtime so their .node binaries resolve correctly.
  serverExternalPackages: [
    "@xenova/transformers",
    "onnxruntime-node",
    "sharp",
    "pdf-parse",
    "mammoth",
  ],
};

export default nextConfig;
