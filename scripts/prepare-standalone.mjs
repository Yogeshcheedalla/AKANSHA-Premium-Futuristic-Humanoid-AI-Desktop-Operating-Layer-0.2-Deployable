// Assembles the Next.js standalone output into a runnable server bundle.
// Next's standalone build emits .next/standalone/server.js + a pruned
// node_modules, but you must copy the static assets and public/ into it
// yourself. Run after `next build`.
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
if (!fs.existsSync(standalone)) {
  console.error('[prepare-standalone] .next/standalone not found — is output:"standalone" set and did `next build` run?');
  process.exit(1);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // Never bundle installer executables into the app (avoids recursion/bloat).
    if (/\.(exe|dmg|appimage|deb|msi)$/i.test(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// .next/static -> .next/standalone/.next/static
copyDir(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'));
// public -> .next/standalone/public
copyDir(path.join(root, 'public'), path.join(standalone, 'public'));

console.log('[prepare-standalone] assembled .next/standalone (server.js + static + public)');
