import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/server-only packages as runtime externals resolved via normal
  // require() from node_modules. Without this, Turbopack externalizes `pg` with
  // a hashed specifier that fails to resolve once the app is relocated into a
  // packaged (Electron) tree, causing every DB-backed route to 500.
  serverExternalPackages: ["pg", "pg-cloudflare", "@modelcontextprotocol/sdk", "nodemailer"],

  // STRICT PUBLIC/APP BOUNDARY.
  // "/" serves the lightweight, fully static public landing page
  // (public/landing.html) — it never boots the dashboard, never mounts the AI
  // workspaces, and therefore never fires repository mapping, model discovery,
  // voice or local-runtime init. The application lives under "/app". This is a
  // web/deployment boundary only; the Electron desktop shell loads "/app"
  // directly and keeps the local llama.cpp runtime.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/landing.html" }],
    };
  },
};

export default nextConfig;
