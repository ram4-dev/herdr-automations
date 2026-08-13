import { describe, expect, test } from "bun:test";
import { assertUnixSocketPathLength, maxUnixSocketPathBytes } from "../../src/util/socket-path.ts";
import { shortSocketTempDir } from "../helpers/short-tmp.ts";
import { join } from "node:path";
import { rmSync } from "node:fs";

describe("unix socket path length", () => {
  test("darwin limit is 103 usable bytes", () => {
    expect(maxUnixSocketPathBytes("darwin")).toBe(103);
    expect(maxUnixSocketPathBytes("linux")).toBe(107);
  });

  test("asserts overlong paths on darwin", () => {
    const long = `/var/folders/${"x".repeat(80)}/T/herdr-warm-ABCDEF/fake/herdr.sock`;
    expect(Buffer.byteLength(long, "utf8")).toBeGreaterThan(103);
    expect(() => assertUnixSocketPathLength(long, "darwin")).toThrow(/too long/);
  });

  test("shortSocketTempDir keeps macOS herdr+control sockets under the limit", () => {
    const root = shortSocketTempDir("hra-");
    try {
      const herdrSock = join(root, "f", "h.sock");
      const controlSock = join(root, "s", "control.sock");
      assertUnixSocketPathLength(herdrSock);
      assertUnixSocketPathLength(controlSock);
      if (process.platform === "darwin") {
        expect(root.startsWith("/private/tmp/hra-")).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
