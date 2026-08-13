import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Darwin sun_path is 104 bytes including NUL → 103 usable. Linux is typically 108/107. */
export function maxUnixSocketPathBytes(platform = process.platform): number {
  return platform === "darwin" ? 103 : 107;
}

export function assertUnixSocketPathLength(path: string, platform = process.platform): void {
  const bytes = Buffer.byteLength(path, "utf8");
  const max = maxUnixSocketPathBytes(platform);
  if (bytes > max) {
    throw new Error(
      `Unix socket path too long for ${platform}: ${bytes} bytes > ${max} (path=${path})`,
    );
  }
}

/**
 * Short temp root for tests that bind real Unix-domain sockets.
 * macOS: force /private/tmp/hra-XXXX to avoid /var/folders/... EPERM from sun_path limits.
 * Other platforms: portable os.tmpdir().
 */
export function shortSocketTempDir(prefix = "hra-"): string {
  const base = process.platform === "darwin" ? "/private/tmp" : tmpdir();
  return mkdtempSync(join(base, prefix));
}
