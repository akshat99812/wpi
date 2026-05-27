import { COLLECTION, getQdrant } from "./qdrant";
import { embedQuery } from "./embed";
import { rewriteQuery } from "./rewrite";

export interface RetrievedChunk {
  id: string | number;
  score: number;
  text: string;
  year: number;
  source_file: string;
  section: string;
  page_start: number;
  page_end: number;
  has_table: boolean;
  // Set on chunks fetched via sibling-expansion (not in the original top-K).
  // Lets the prompt order siblings together by table_index and helps the
  // /chat meta event distinguish the originals from the expansions.
  via_sibling_expansion?: boolean;
}

export interface RetrieveOptions {
  topK?: number;
  // Either an exact year or an inclusive [from, to] range.
  year?: number | [number, number];
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  original: string;
  // Canonical user query (typos/abbrevs fixed) — pass this to the LLM
  // instead of the original, so the LLM and the chunks agree on spellings.
  canonical: string;
  expansions: string[];
}

export async function retrieve(
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrieveResult> {
  // top-K default 15. Tables in this corpus span multiple chunks (a single
  // State+Make table fragments across 4-6 chunks at 800 tokens each);
  // 8 was too small to consistently surface the right slice. 15 keeps
  // generation cost modest (passages are <600 tokens each on average).
  const topK = opts.topK ?? 15;

  const rw = rewriteQuery(query);

  let filter: Record<string, unknown> | undefined;
  if (typeof opts.year === "number") {
    filter = { must: [{ key: "year", match: { value: opts.year } }] };
  } else if (Array.isArray(opts.year)) {
    const [gte, lte] = opts.year;
    filter = { must: [{ key: "year", range: { gte, lte } }] };
  }

  // Multi-query union: embed the embedText (canonical + domain hints) plus
  // each variant, pull topK from each, then dedupe by point id keeping max
  // score, sort, and truncate to topK. Cheap (~1 embed call per variant)
  // and dramatically improves recall on queries whose answer lives in a
  // section the user's phrasing doesn't naturally embed near.
  const queries = [rw.embedText, ...rw.variants];
  const perQuery = Math.max(topK, 10);

  const vectors = await Promise.all(queries.map((q) => embedQuery(q)));
  const merged = new Map<string | number, { hit: any; score: number }>();
  const qdrant = getQdrant();
  await Promise.all(
    vectors.map(async (vec) => {
      const hits = await qdrant.search(COLLECTION, {
        vector: vec,
        limit: perQuery,
        with_payload: true,
        filter: filter as never,
      });
      for (const h of hits) {
        const prev = merged.get(h.id);
        if (!prev || h.score > prev.score) merged.set(h.id, { hit: h, score: h.score });
      }
    }),
  );
  const hits = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.hit);

  const chunks: RetrievedChunk[] = hits.map((h) => {
    const p = (h.payload ?? {}) as Record<string, unknown>;
    return {
      id: h.id,
      score: h.score,
      text: String(p.text ?? ""),
      year: Number(p.year ?? 0),
      source_file: String(p.source_file ?? ""),
      section: String(p.section ?? ""),
      page_start: Number(p.page_start ?? -1),
      page_end: Number(p.page_end ?? -1),
      has_table: Boolean(p.has_table),
    };
  });

  // Sibling expansion: when a multi-part table has any chunk in the top-K,
  // fetch the rest. Without this, a question like "list all 41 inactive
  // manufacturers" gets a partial answer — retrieval scores chunks 2+3
  // higher than chunk 1 (which holds rows 1-20), so the LLM never sees
  // the first 20 rows. Sibling-expansion guarantees the LLM sees the
  // whole table whenever any piece of it is retrieved.
  const tableKeys = new Map<string, { source_file: string; table_index: number }>();
  for (const h of hits) {
    const p = (h.payload ?? {}) as Record<string, unknown>;
    const ti = p.table_index;
    const sf = p.source_file;
    if (typeof ti === "number" && typeof sf === "string") {
      tableKeys.set(`${sf}::${ti}`, { source_file: sf, table_index: ti });
    }
  }
  if (tableKeys.size > 0) {
    const seenIds = new Set(chunks.map((c) => String(c.id)));
    await Promise.all(
      [...tableKeys.values()].map(async ({ source_file, table_index }) => {
        const sibs = await qdrant.scroll(COLLECTION, {
          filter: {
            must: [
              { key: "source_file", match: { value: source_file } },
              { key: "table_index", match: { value: table_index } },
            ],
          } as never,
          limit: 32,  // tables here split into at most ~5 chunks; 32 is slack
          with_payload: true,
          with_vector: false,
        });
        for (const pt of sibs.points) {
          if (seenIds.has(String(pt.id))) continue;
          seenIds.add(String(pt.id));
          const p = (pt.payload ?? {}) as Record<string, unknown>;
          chunks.push({
            id: pt.id,
            score: 0,  // sibling — no native vector score
            text: String(p.text ?? ""),
            year: Number(p.year ?? 0),
            source_file: String(p.source_file ?? ""),
            section: String(p.section ?? ""),
            page_start: Number(p.page_start ?? -1),
            page_end: Number(p.page_end ?? -1),
            has_table: Boolean(p.has_table),
            via_sibling_expansion: true,
          });
        }
      }),
    );
    // Re-sort: sibling chunks slot in next to their kin by (source_file, table_index, rows_from).
    // The originals stay ranked by score; siblings cluster under them.
  }

  return { chunks, original: rw.original, canonical: rw.canonical, expansions: rw.expansions };
}
