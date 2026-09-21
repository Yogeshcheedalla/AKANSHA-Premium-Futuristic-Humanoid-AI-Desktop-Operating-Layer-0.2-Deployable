import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/server-only packages as runtime externals resolved via normal
  // require() from node_modules. Without this, Turbopack externalizes `pg` with
  // a hashed specifier that fails to resolve once the app is relocated into a
  // packaged (Electron) tree, causing every DB-backed route to 500.
  //
  // @huggingface/transformers + onnxruntime-node are PATH A for FREE offline
  // voice (local Whisper). They ship prebuilt native .node binaries and
  // onnx/wasm data files that CANNOT be bundled and must resolve via normal
  // require() from node_modules — same reason as pg. Without these listed, the
  // /api/voice/transcribe route fails to load the local ASR module and voice
  // silently degrades to cloud-only (which needs an API key = NOT free).
  serverExternalPackages: ["pg", "pg-cloudflare", "@modelcontextprotocol/sdk", "nodemailer", "@huggingface/transformers", "onnxruntime-node"],

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
