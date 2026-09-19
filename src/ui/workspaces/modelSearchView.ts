/**
 * Model Center Search view mapping — pure + testable. Turns /api/models/search
 * results into cards, and gates INSTALL to models the EXISTING signed ModelManager
 * pipeline can actually handle (present in the catalog + classified installable).
 * A discovered model that isn't a signed, checksum-pinned catalog entry is shown
 * with its source + reason, never a fake one-click INSTALL.
 */
import type { RankedDiscoveredModel, DeviceClassification } from '@/core/models/discovery/modelDiscovery';

export interface SearchCard {
  id: string;
  name: string;
  publisher: string;
  gguf: boolean;
  downloads: number;
  likes: number;
  license?: string;
  repoUrl: string;
  installable: boolean;
  installReason: string;
  classification: DeviceClassification;
}

export function toSearchCards(results: RankedDiscoveredModel[], catalogModelIds: Iterable<string>): SearchCard[] {
  const catalog = new Set(catalogModelIds);
  return results.map((r) => {
    const inCatalog = catalog.has(r.id);
    const installable = inCatalog && r.classification.installable;
    const installReason = !inCatalog
      ? 'Not in Akansha’s signed catalog — one-click install needs a checksum-pinned entry. Open the source page to review.'
      : r.classification.reason;
    return {
      id: r.id,
      name: (r.id.split('/').pop() || r.id),
      publisher: r.author,
      gguf: r.isGguf,
      downloads: r.downloads,
      likes: r.likes,
      license: r.license,
      repoUrl: r.repoUrl,
      installable,
      installReason,
      classification: r.classification,
    };
  });
}
