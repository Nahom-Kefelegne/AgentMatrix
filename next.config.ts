import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Pin the workspace root. Without this, Turbopack walks up the tree and
  // can pick an ancestor lockfile (e.g. when building from a git worktree
  // nested inside the main repo), resolving modules from two node_modules
  // trees → duplicate React → "Cannot read properties of null (reading
  // 'useContext')" during /_global-error prerender. Pinning forces a single
  // resolution root.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
