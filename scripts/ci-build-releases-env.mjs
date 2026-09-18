/**
 * ci-build-releases-env.mjs
 *
 * Used by the gated `release-publish` CI job to close the loop back to
 * /api/releases: it reads the just-published GitHub Release's assets and emits
 * the AKANSHA_RELEASES JSON array the app expects:
 *   [{ platform, architecture, type, filename, url, sha256, version }]
 *
 * It NEVER invents availability — the app's /api/releases still HEAD-verifies
 * each URL live; this only configures WHICH artifacts exist. If a SHA can't be
 * resolved from the release body it is simply omitted (informational field).
 *
 * Usage: node ci-build-releases-env.mjs <owner/repo> <tag>
 * Env:   GH_TOKEN (or GITHUB_TOKEN)
 * Output: compact JSON array on stdout (nothing else).
 */
const [repo, tag] = process.argv.slice(2);
if (!repo || !tag) { console.error('usage: ci-build-releases-env.mjs <owner/repo> <tag>'); process.exit(2); }
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) { console.error('GH_TOKEN/GITHUB_TOKEN required'); process.exit(2); }

function classify(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.exe')) {
    if (n.includes('portable')) return { platform: 'windows', architecture: 'x64', type: 'portable' };
    return { platform: 'windows', architecture: 'x64', type: 'installer' };
  }
  if (n.endsWith('.appimage')) return { platform: 'linux', architecture: 'x64', type: 'appimage' };
  if (n.endsWith('.deb')) return { platform: 'linux', architecture: 'amd64', type: 'deb' };
  if (n.endsWith('.dmg')) {
    const arch = n.includes('arm64') || n.includes('aarch64') ? 'arm64' : n.includes('x64') ? 'x64' : 'universal';
    return { platform: 'macos', architecture: arch, type: 'dmg' };
  }
  if (n.endsWith('.apk')) return { platform: 'android', architecture: 'arm64', type: 'apk' };
  return null;
}

async function main() {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'akansha-ci' },
    redirect: 'follow',
  });
  if (!res.ok) { console.error(`release fetch failed: ${res.status}`); process.exit(1); }
  const rel = await res.json();

  // Pull SHA-256 per filename from the release body (the publish job writes
  // "<sha>  <name>  <bytes> bytes" lines there).
  const shaByName = {};
  for (const m of String(rel.body || '').matchAll(/([0-9a-f]{64})\s+(\S+)/g)) shaByName[m[2]] = m[1];

  const entries = [];
  for (const a of (rel.assets || [])) {
    const cls = classify(a.name);
    if (!cls) continue;
    const entry = { ...cls, filename: a.name, url: a.browser_download_url, version: (tag || '').replace(/^v/, '') };
    if (shaByName[a.name]) entry.sha256 = shaByName[a.name];
    entries.push(entry);
  }
  if (!entries.length) { console.error('no classifiable assets on the release'); process.exit(1); }
  process.stdout.write(JSON.stringify(entries));
}
main().catch((e) => { console.error(e?.message || e); process.exit(1); });
