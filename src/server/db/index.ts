import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
export const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const globalDb = globalThis as unknown as { mclDb?: ReturnType<typeof openDb> };
function openDb() {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const sqlite = new Database(path.join(dataDir, "lab.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve("drizzle") });
  return db;
}
export function db() {
  return (globalDb.mclDb ??= openDb());
}
