/**
 * Cross-platform .env bootstrap (Windows / macOS / Linux).
 * Copies .env.example → .env when missing.
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = path.join(root, ".env.example");
const target = path.join(root, ".env");

if (existsSync(target)) {
  console.log(".env already exists — leave as-is");
  process.exit(0);
}

if (!existsSync(example)) {
  console.error("Missing .env.example");
  process.exit(1);
}

copyFileSync(example, target);
console.log("Created .env from .env.example");
