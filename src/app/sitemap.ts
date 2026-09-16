import type { MetadataRoute } from "next";

const base = process.env.AKANSHA_PUBLIC_URL || "https://akansha.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: base + "/", lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: base + "/landing.html", lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];
}
