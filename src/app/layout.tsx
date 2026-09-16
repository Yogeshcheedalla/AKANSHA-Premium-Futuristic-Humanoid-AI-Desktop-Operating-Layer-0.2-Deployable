import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AKANSHA_PUBLIC_URL || "https://akansha.ai"),
  title: "Akansha — Premium Futuristic Humanoid AI Desktop Operating Layer",
  description:
    "A premium futuristic humanoid AI operating layer: one authoritative orchestrator with multi-provider online AI, verified local offline AI (llama.cpp + signed models), voice, memory, agents and security. Web + desktop.",
  keywords: ["AI operating layer", "agentic AI", "local AI", "offline AI", "OpenRouter", "llama.cpp", "Electron", "voice assistant", "Next.js"],
  authors: [{ name: "Akansha" }],
  alternates: { canonical: "/" },
  openGraph: {
    title: "Akansha — Premium Futuristic Humanoid AI Desktop Operating Layer",
    description:
      "One intelligence. Many providers. Zero competing brains. Understand, reason, execute, observe, verify, remember, improve — on web and desktop.",
    type: "website",
    url: "/",
    siteName: "Akansha",
    images: [{ url: "/assets/hero.png", width: 1792, height: 1024, alt: "Akansha — AI operating layer" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Akansha — Premium Futuristic Humanoid AI Desktop Operating Layer",
    description: "One intelligence. Many providers. Zero competing brains.",
    images: ["/assets/hero.png"],
  },
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Akansha" },
};

export const viewport: Viewport = {
  themeColor: "#00f0ff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#010208] text-[#f0f4ff] antialiased min-h-screen overflow-x-hidden selection:bg-cyan-500/20">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`,
          }}
        />
      </body>
    </html>
  );
}
