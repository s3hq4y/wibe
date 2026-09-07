import { type Database } from "sqlite";
import sqlite3 from "sqlite3";

// The codebase indexer (LanceDB / full-text / chunk indexes) has been removed.
// This module only keeps the small sqlite helpers that are still shared by the
// autocomplete LRU cache and the dev-data sqlite store.

export type DatabaseConnection = Database<sqlite3.Database>;

const SQLITE_MAX_LIKE_PATTERN_LENGTH = 50000;

export function truncateToLastNBytes(input: string, maxBytes: number): string {
  let bytes = 0;
  let startIndex = 0;

  for (let i = input.length - 1; i >= 0; i--) {
    bytes += new TextEncoder().encode(input[i]).length;
    if (bytes > maxBytes) {
      startIndex = i + 1;
      break;
    }
  }

  return input.substring(startIndex, input.length);
}

export function truncateSqliteLikePattern(input: string, safety: number = 100) {
  return truncateToLastNBytes(input, SQLITE_MAX_LIKE_PATTERN_LENGTH - safety);
}
