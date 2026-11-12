// scripts/check-migrations.mjs (2026-11-12, push 50: audit round 2, R14)
//
// Checks the migrations in supabase/migrations against the rules in its README, so a slip is caught
// before the file is run by hand in production:
//   - the name is pNNN-short-description.sql and no number is used twice;
//   - it ends by writing its own name to the ledger (public._migrations);
//   - every statement is safe to run twice: create table / index / sequence with "if not exists",
//     create function / view with "or replace", a trigger dropped (or "or replace") before it is
//     created, a policy dropped before it is created, add column with "if not exists", and every
//     drop with "if exists".
// Comments, quoted text and function bodies are ignored. Statements inside a do block are not
// checked: a do block decides for itself.
//
//   node scripts/check-migrations.mjs            the migrations from p146 on (the ledger era)
//   node scripts/check-migrations.mjs --all      every numbered migration (older ones predate the rules)
//
// tests/check-migrations.test.ts runs it on every new migration (p171 on), so `npm test` fails on one
// that breaks a rule.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "supabase", "migrations");

/** The SQL with comments and quoted text removed (dollar-quoted bodies included), split into statements. */
export function statements(sql) {
  const out = [];
  let buf = "", i = 0, q = null;
  while (i < sql.length) {
    const ch = sql[i];
    if (q === null) {
      if (ch === "-" && sql[i + 1] === "-") { const j = sql.indexOf("\n", i); i = j < 0 ? sql.length : j; continue; }
      if (ch === "/" && sql[i + 1] === "*") { const j = sql.indexOf("*/", i + 2); i = j < 0 ? sql.length : j + 2; continue; }
      if (ch === "'" || ch === '"') { q = ch; buf += ch === '"' ? ch : "''"; i++; continue; }
      if (ch === "$") { const m = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(sql.slice(i)); if (m) { q = m[0]; buf += " $body$ "; i += q.length; continue; } }
      if (ch === ";") { if (buf.trim()) out.push(buf.trim()); buf = ""; i++; continue; }
      buf += ch; i++;
    } else if (q.length === 1) {
      if (ch === q) { if (sql[i + 1] === q) { i += 2; continue; } if (q === '"') buf += ch; q = null; i++; continue; }
      if (q === '"') buf += ch;
      i++;
    } else {
      if (sql.startsWith(q, i)) { i += q.length; q = null; continue; }
      i++;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.map((s) => s.replace(/\s+/g, " "));
}

/** The problems in one migration file. */
export function checkMigration(name, sql) {
  const problems = [];
  const base = name.replace(/\.sql$/, "");
  if (!/^p\d+-[a-z0-9-]+$/.test(base)) problems.push("the name is not pNNN-short-description.sql");
  const stmts = statements(sql);
  const rawLedger = new RegExp(`insert into public\\._migrations\\s*\\(name\\)\\s*values\\s*\\('${base.replace(/[-]/g, "\\-")}'\\)`, "i");
  if (!rawLedger.test(sql)) problems.push(`no ledger line for ${base} (insert into public._migrations (name) values ('${base}') on conflict do nothing)`);
  const dropped = new Set();
  for (const s of stmts) {
    const low = s.toLowerCase();
    if (/^do\b/.test(low)) continue;
    let m;
    if ((m = /^drop policy if exists ("[^"]+"|\S+) on (\S+)/.exec(low))) dropped.add(`policy ${m[1]} ${m[2]}`);
    if ((m = /^drop trigger if exists (\S+) on (\S+)/.exec(low))) dropped.add(`trigger ${m[1]} ${m[2]}`);
    if (/^create (unlogged )?table (?!if not exists)/.test(low)) problems.push(`create table without "if not exists": ${s.slice(0, 90)}`);
    if (/^create (unique )?index (?!if not exists)/.test(low)) problems.push(`create index without "if not exists": ${s.slice(0, 90)}`);
    if (/^create sequence (?!if not exists)/.test(low)) problems.push(`create sequence without "if not exists": ${s.slice(0, 90)}`);
    if (/^create (function|view|materialized view) /.test(low) && !/^create materialized view if not exists/.test(low)) problems.push(`create ${/^create view/.test(low) ? "view" : "function"} without "or replace": ${s.slice(0, 90)}`);
    if ((m = /^create (constraint )?trigger (\S+) .*? on (\S+)/.exec(low)) && !dropped.has(`trigger ${m[2]} ${m[3]}`)) problems.push(`trigger ${m[2]} created without "drop trigger if exists" first`);
    if ((m = /^create policy ("[^"]+"|\S+) on (\S+)/.exec(low)) && !dropped.has(`policy ${m[1]} ${m[2]}`)) problems.push(`policy ${m[1]} created without "drop policy if exists" first`);
    if (/^alter table .* add column (?!if not exists)/.test(low)) problems.push(`add column without "if not exists": ${s.slice(0, 90)}`);
    if (/^drop (table|function|view|index|trigger|policy|type|sequence) (?!if exists)/.test(low)) problems.push(`drop without "if exists": ${s.slice(0, 90)}`);
    if (/^alter table .* drop column (?!if exists)/.test(low)) problems.push(`drop column without "if exists": ${s.slice(0, 90)}`);
  }
  return problems;
}

/** Every numbered migration from `from` on: [{ file, problems }], plus numbers used twice. */
export function checkAll(from = 146) {
  const files = fs.readdirSync(DIR).filter((f) => /^p\d+-.*\.sql$/.test(f));
  const byNum = new Map();
  for (const f of files) { const n = Number(/^p(\d+)/.exec(f)[1]); byNum.set(n, [...(byNum.get(n) ?? []), f]); }
  const out = [];
  for (const f of files.sort((a, b) => Number(/^p(\d+)/.exec(a)[1]) - Number(/^p(\d+)/.exec(b)[1]))) {
    const n = Number(/^p(\d+)/.exec(f)[1]);
    if (n < from) continue;
    const problems = checkMigration(f, fs.readFileSync(path.join(DIR, f), "utf8"));
    if ((byNum.get(n) ?? []).length > 1) problems.push(`number ${n} is also used by ${byNum.get(n).filter((x) => x !== f).join(", ")}`);
    out.push({ file: f, problems });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const all = checkAll(process.argv.includes("--all") ? 0 : 146);
  let bad = 0;
  for (const r of all) {
    if (!r.problems.length) continue;
    bad++;
    console.log(`${r.file}`);
    for (const p of r.problems) console.log(`  - ${p}`);
  }
  console.log(`${all.length} migration(s) checked, ${bad} with problems.`);
  process.exitCode = bad ? 1 : 0;
}
