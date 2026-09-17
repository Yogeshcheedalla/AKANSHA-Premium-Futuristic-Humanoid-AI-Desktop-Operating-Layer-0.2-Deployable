import crypto from 'crypto';
import fs from 'fs';

/**
 * Compute a file's real SHA-256 + byte size by streaming (never loads the whole
 * ~145 MB installer into memory). Used to populate the truth-driven release manifest
 * (AKANSHA_RELEASES) with an integrity hash that is MEASURED from the built artifact —
 * never invented. A consumer can re-hash the downloaded file against this value.
 */
export function hashFileSync(filePath: string): { sha256: string; size: number } {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest('hex').toLowerCase(), size: fs.statSync(filePath).size };
}
