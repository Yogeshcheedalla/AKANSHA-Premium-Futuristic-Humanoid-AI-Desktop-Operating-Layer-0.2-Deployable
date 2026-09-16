import type { MetadataRoute } from "next";

const base = process.env.AKANSHA_PUBLIC_URL || "https://akansha.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
