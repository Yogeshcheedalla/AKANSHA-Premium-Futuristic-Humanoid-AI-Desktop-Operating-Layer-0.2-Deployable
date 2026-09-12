import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/server-only packages as runtime externals resolved via normal
  // require() from node_modules. Without this, Turbopack externalizes `pg` with
  // a hashed specifier that fails to resolve once the app is relocated into a
  // packaged (Electron) tree, causing every DB-backed route to 500.
  serverExternalPackages: ["pg", "pg-cloudflare", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
