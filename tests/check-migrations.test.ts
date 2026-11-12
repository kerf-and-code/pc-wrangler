// tests/check-migrations.test.ts (2026-11-12, push 50: audit round 2, R14)
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no type declarations
import { checkAll, checkMigration, statements } from "../scripts/check-migrations.mjs";

describe("migration rules", () => {
  it("every migration from p146 on follows them", () => {
    const bad = (checkAll(146) as { file: string; problems: string[] }[]).filter((r) => r.problems.length);
    expect(bad).toEqual([]);
  });
  it("catches a statement that cannot run twice, and a missing ledger line", () => {
    const p = checkMigration("p999-bad.sql", "create table public.x (id int);\ncreate policy \"read\" on public.x for select using (true);\nalter table public.x add column y int;\n") as string[];
    expect(p.some((x) => x.includes("create table"))).toBe(true);
    expect(p.some((x) => x.includes("policy"))).toBe(true);
    expect(p.some((x) => x.includes("add column"))).toBe(true);
    expect(p.some((x) => x.includes("ledger"))).toBe(true);
  });
  it("accepts the idempotent forms and skips do blocks and function bodies", () => {
    const sql = [
      "create table if not exists public.x (id int);",
      "drop policy if exists \"read\" on public.x;",
      "create policy \"read\" on public.x for select using (true);",
      "create or replace function public.f() returns void language plpgsql as $f$ begin create table t (a int); end $f$;",
      "do $t1$ begin create trigger z after insert on public.x for each row execute function public.f(); end $t1$;",
      "insert into public._migrations (name) values ('p998-good') on conflict do nothing;",
    ].join("\n");
    expect(checkMigration("p998-good.sql", sql)).toEqual([]);
    expect((statements("select 1; -- a; b\nselect 'x;y';") as string[]).length).toBe(2);
  });
});
