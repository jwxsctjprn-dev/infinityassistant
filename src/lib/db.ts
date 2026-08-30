/**
 * HologramOS — Prisma client accessor.
 *
 * LAZY by design: Next's build imports every route module (page-data
 * collection), so constructing PrismaClient at module scope would evaluate
 * the Prisma engine during `next build` — and fail on hosts that never ran
 * `prisma generate` (Vercel). The client is constructed on first actual use
 * and cached; a failed construction throws inside the API handler, which
 * returns a clean 500 the Notes app surfaces inline.
 */

import type { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/** First call constructs (and caches) the client. Throws if the engine or
 *  DATABASE_URL is unavailable — callers are expected to catch. */
export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient: Client } = require("@prisma/client") as {
      PrismaClient: new (opts: { log: ("query" | "error" | "warn")[] }) => PrismaClient;
    };
    globalForPrisma.prisma = new Client({ log: ["query", "error"] });
  }
  return globalForPrisma.prisma;
}
