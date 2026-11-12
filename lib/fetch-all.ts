// lib/fetch-all.ts (2026-11-12, push 46: audit round 2, R1)
//
// PostgREST returns at most 1,000 rows per read, whatever .limit() asks for, and says nothing when it
// stops there. Anything that counts or sums rows reads them all through this: pages of 1,000 until a
// short page, each read built fresh by `page(from, to)` (which must order by something stable, an id
// last, so no row is skipped or read twice between pages).

export const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxPages = 100,
): Promise<{ data: T[]; error: string | null; complete: boolean }> {
  const out: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) return { data: out, error: error.message, complete: false };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return { data: out, error: null, complete: true };
  }
  return { data: out, error: null, complete: false };
}
