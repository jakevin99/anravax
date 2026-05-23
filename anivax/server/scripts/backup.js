#!/usr/bin/env node
/**
 * Nightly SQLite backup.
 *
 * Run from cron / Task Scheduler:
 *   0 2 * * *  cd /opt/anivax/anivax && node server/scripts/backup.js
 *
 * Behaviour:
 *  - Uses sqlite3's online backup API (no risk of partial writes during VACUUM).
 *  - Writes to `BACKUP_DIR` (default `server/data/backups`).
 *  - Keeps the last `BACKUP_KEEP_DAYS` files (default 30); older ones are deleted.
 */

import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";

const SOURCE = path.resolve(process.cwd(), "server", "data", "anivax.sqlite");
const BACKUP_DIR = path.resolve(
  process.cwd(),
  process.env.BACKUP_DIR ?? "server/data/backups",
);
const KEEP_DAYS = Number.parseInt(process.env.BACKUP_KEEP_DAYS ?? "30", 10) || 30;

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

async function backupOnce() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`[anivax/backup] no source DB at ${SOURCE}`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `anivax-${timestamp()}.sqlite`);

  // Copy bytes via sqlite3's backup API. The package exposes it as
  // `db.backup(target)`. Fallback: a plain file copy when the API is missing.
  const src = new sqlite3.Database(SOURCE, sqlite3.OPEN_READONLY);
  await new Promise((resolve, reject) => {
    if (typeof src.backup === "function") {
      const handle = src.backup(target);
      handle.step(-1, (err) => {
        if (err) {
          reject(err);
          return;
        }
        handle.finish((finishErr) => {
          if (finishErr) reject(finishErr);
          else resolve();
        });
      });
    } else {
      try {
        fs.copyFileSync(SOURCE, target);
        resolve();
      } catch (e) {
        reject(e);
      }
    }
  });
  src.close();

  console.log(`[anivax/backup] wrote ${target}`);

  // Prune old files.
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    const file = path.join(BACKUP_DIR, name);
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(file);
        console.log(`[anivax/backup] pruned ${file}`);
      }
    } catch {
      /* ignore */
    }
  }
}

backupOnce().catch((e) => {
  console.error(`[anivax/backup] failed: ${e?.message ?? e}`);
  process.exit(1);
});
