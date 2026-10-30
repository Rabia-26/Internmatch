#!/usr/bin/env node
/**
 * Applies supabase/schema.sql to your remote Supabase Postgres database.
 *
 * Requires in .env.local:
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_DB_PASSWORD=...  (Dashboard → Settings → Database → Database password)
 *
 * Optional override:
 *   DATABASE_URL=postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const dbPassword = process.env.SUPABASE_DB_PASSWORD;
const ref = projectRefFromUrl(supabaseUrl ?? "");

let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  if (!ref || !dbPassword) {
    console.error(
      [
        "Missing database connection.",
        "Add to .env.local:",
        "  SUPABASE_DB_PASSWORD=<your Postgres password>",
        "Get it from: Supabase Dashboard → Project Settings → Database → Database password",
        "",
        "Or set DATABASE_URL=postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres",
      ].join("\n"),
    );
    process.exit(1);
  }
  connectionString = `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${ref}.supabase.co:5432/postgres`;
}

const schemaPath = path.join(root, "supabase", "schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log("Connected to Postgres. Applying schema…");
  await client.query(sql);
  console.log("Schema applied successfully.");
} catch (err) {
  console.error("Schema apply failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
