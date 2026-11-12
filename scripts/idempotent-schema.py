"""scripts/idempotent-schema.py (2026-11-12, push 50: audit round 2, T13)

Turns a `pg_dump --schema-only --schema=public` file into the form supabase/migrations/0000-base-schema.sql
uses: every statement safe to run twice on the same database.

    python scripts/idempotent-schema.py dump.sql > supabase/migrations/0000-base-schema.sql.body

  CREATE TABLE / SEQUENCE / INDEX         -> ... IF NOT EXISTS
  CREATE FUNCTION / VIEW / TRIGGER        -> CREATE OR REPLACE ...
  CREATE POLICY                           -> DROP POLICY IF EXISTS, then CREATE POLICY
  ALTER TABLE ... ADD CONSTRAINT          -> only when no constraint of that name is on the table
  ALTER TABLE ... ADD GENERATED AS IDENTITY -> only when the column is not an identity column yet
  CREATE TYPE                             -> only when no type of that name exists
  CREATE SCHEMA public / ALTER SCHEMA public, psql meta-commands and comments are dropped.
Everything else (ALTER ... OWNER, ENABLE ROW LEVEL SECURITY, GRANT, REVOKE, COMMENT, SET, SELECT
set_config) is already idempotent and passes through unchanged.

Statements are split on semicolons outside quotes and dollar quotes, so function bodies survive whole.
docs/base-schema.md has the whole refresh, including how the result was tested.
"""
import re
import sys


def statements(text):
    out, buf, i, n = [], [], 0, len(text)
    quote = None          # "'" or '"' or a dollar tag like "$$" / "$_$" / "$function$"
    while i < n:
        ch = text[i]
        if quote is None:
            if ch == "-" and text.startswith("--", i):
                j = text.find("\n", i)
                j = n if j < 0 else j
                i = j
                continue
            if ch in ("'", '"'):
                quote = ch
            elif ch == "$":
                m = re.match(r"\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$", text[i:])
                if m:
                    quote = m.group(0)
                    buf.append(quote)
                    i += len(quote)
                    continue
            elif ch == ";":
                s = "".join(buf).strip()
                if s:
                    out.append(s)
                buf = []
                i += 1
                continue
            buf.append(ch)
            i += 1
        else:
            if len(quote) == 1:
                buf.append(ch)
                if ch == quote:
                    if i + 1 < n and text[i + 1] == quote:   # doubled quote inside a literal
                        buf.append(text[i + 1])
                        i += 2
                        continue
                    quote = None
                i += 1
            else:
                if text.startswith(quote, i):
                    buf.append(quote)
                    i += len(quote)
                    quote = None
                else:
                    buf.append(ch)
                    i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def lit(s):
    return "'" + s.replace("'", "''") + "'"


def guarded(cond, stmt):
    return f"do $guard$ begin\n  if {cond} then\n    execute {lit(stmt)};\n  end if;\nend $guard$"


def convert(stmt):
    head = stmt.lstrip()
    if head.startswith("\\"):
        return None
    if re.match(r"(?i)^(create|alter) schema public\b", head):
        return None
    m = re.match(r"(?is)^create table (\S+)", head)
    if m:
        return re.sub(r"(?i)^create table ", "CREATE TABLE IF NOT EXISTS ", head, count=1)
    if re.match(r"(?i)^create sequence ", head):
        return re.sub(r"(?i)^create sequence ", "CREATE SEQUENCE IF NOT EXISTS ", head, count=1)
    m = re.match(r"(?i)^create (unique )?index ", head)
    if m:
        return re.sub(r"(?i)^create (unique )?index ", lambda x: f"CREATE {x.group(1) or ''}INDEX IF NOT EXISTS ", head, count=1)
    if re.match(r"(?i)^create function ", head):
        return re.sub(r"(?i)^create function ", "CREATE OR REPLACE FUNCTION ", head, count=1)
    if re.match(r"(?i)^create view ", head):
        return re.sub(r"(?i)^create view ", "CREATE OR REPLACE VIEW ", head, count=1)
    if re.match(r"(?i)^create (constraint )?trigger ", head):
        return re.sub(r"(?i)^create trigger ", "CREATE OR REPLACE TRIGGER ", head, count=1)
    m = re.match(r'(?is)^create policy ("(?:[^"]|"")+"|\S+) on (\S+)', head)
    if m:
        return f"DROP POLICY IF EXISTS {m.group(1)} ON {m.group(2)};\n{head}"
    m = re.match(r'(?is)^alter table (?:only )?(\S+)\s+add constraint ("(?:[^"]|"")+"|\S+)', head)
    if m:
        table, con = m.group(1), m.group(2).strip('"').replace('""', '"')
        return guarded(f"not exists (select 1 from pg_constraint where conname = {lit(con)} and conrelid = {lit(table)}::regclass)", head)
    m = re.match(r'(?is)^alter table (?:only )?(\S+)\s+alter column ("(?:[^"]|"")+"|\S+)\s+add generated', head)
    if m:
        table, col = m.group(1), m.group(2).strip('"')
        return guarded(f"not exists (select 1 from pg_attribute where attrelid = {lit(table)}::regclass and attname = {lit(col)} and attidentity <> '')", head)
    m = re.match(r"(?is)^create type (\S+)", head)
    if m:
        name = m.group(1)
        return guarded(f"to_regtype({lit(name)}) is null", head)
    return head


def main():
    text = open(sys.argv[1], encoding="utf-8").read()
    for s in statements(text):
        c = convert(s)
        if c:
            sys.stdout.write(c + ";\n\n")


if __name__ == "__main__":
    main()
