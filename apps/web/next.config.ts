import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Workspace packages (prebuilt dist/ + source transpile fallback)
  transpilePackages: ["@fonglish/shared", "@fonglish/audio"],
  // Monorepo file tracing (include root packages on Vercel)
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
