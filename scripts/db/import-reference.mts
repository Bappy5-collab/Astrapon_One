/**
 * pnpm db:import-reference [--dry-run]
 *
 * Idempotent import of sourced reference datasets. For each dataset the canonical content hash is
 * compared with the newest published version: unchanged → skipped; changed or new → a new version is
 * inserted as draft, filled, then published, and the previous version is retired (still readable, so
 * snapshots that pinned it keep resolving). Published versions are never edited.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "../../src/domain/reference/canonical.ts";
import { buildReferenceDatasets, type CitationRecord } from "../../src/domain/reference/datasets.ts";
import { connect, runMain } from "./connect.mts";

const DRY = process.argv.includes("--dry-run");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const citationHash = (c: CitationRecord) => sha(canonicalJson(c));

runMain(async () => {
  const nassText = readFileSync(new URL("../../data/reference/usda-nass-usual-dates-2010.txt", import.meta.url), "utf8");
  const faoCalendar = JSON.parse(readFileSync(new URL("../../data/reference/fao-crop-calendar.json", import.meta.url), "utf8"));
  const { citations, datasets } = buildReferenceDatasets({ nassText, faoCalendar });
  const citationHashByKey = new Map(citations.map((c) => [c.citationKey, citationHash(c)]));

  const plans = datasets.map((d) => {
    const items = [...d.items].sort((a, b) => a.itemKey.localeCompare(b.itemKey));
    const content = items.map((i) => ({
      itemKey: i.itemKey,
      payload: i.payload,
      citations: i.citationKeys.map((k) => {
        const h = citationHashByKey.get(k);
        if (!h) throw new Error(`Item ${d.name}/${i.itemKey} cites unknown citation ${k}`);
        return h;
      }).sort(),
    }));
    return { ...d, items, contentSha256: sha(canonicalJson({ kind: d.kind, name: d.name, description: d.description, items: content })) };
  });

  if (DRY) {
    for (const p of plans) console.log(`${p.kind}/${p.name}: ${p.items.length} items, sha256 ${p.contentSha256.slice(0, 12)}`);
    console.log(`${citations.length} citations. Dry run; nothing written.`);
    return 0;
  }

  const { sql } = connect();
  try {
    await sql.begin(async (tx) => {
      let newCitations = 0;
      for (const c of citations) {
        const res = await tx`
          insert into public.reference_citations (citation_key, citation, url, doi, verification, content_sha256)
          values (${c.citationKey}, ${c.citation}, ${c.url}, ${c.doi}, ${c.verification}, ${citationHashByKey.get(c.citationKey)!})
          on conflict (citation_key, content_sha256) do nothing`;
        newCitations += res.count;
      }
      console.log(`Citations: ${newCitations} new, ${citations.length - newCitations} unchanged.`);

      for (const p of plans) {
        const [latest] = await tx`
          select id, version, status, content_sha256 from public.reference_datasets
          where kind = ${p.kind} and name = ${p.name} order by version desc limit 1`;
        if (latest?.status === "published" && latest.content_sha256 === p.contentSha256) {
          console.log(`${p.kind}/${p.name}: v${latest.version} unchanged (sha256 ${p.contentSha256.slice(0, 12)}).`);
          continue;
        }
        if (latest?.status === "draft") throw new Error(`${p.name} v${latest.version} is a leftover draft; inspect it before importing.`);
        const version = (latest?.version ?? 0) + 1;
        const [ds] = await tx`
          insert into public.reference_datasets (kind, name, version, description)
          values (${p.kind}, ${p.name}, ${version}, ${p.description}) returning id`;
        // Batched inserts (500 items per statement) so large datasets import over slow links.
        for (let i = 0; i < p.items.length; i += 500) {
          const chunk = p.items.slice(i, i + 500);
          const rows = await tx`
            insert into public.reference_items ${tx(chunk.map((item) => ({ dataset_id: ds.id, item_key: item.itemKey, payload: tx.json(JSON.parse(canonicalJson(item.payload))) })), "dataset_id", "item_key", "payload")}
            returning id, item_key`;
          const idByKey = new Map(rows.map((r) => [r.item_key as string, r.id as string]));
          const links: { item_id: string; key: string; sha: string }[] = [];
          for (const item of chunk) for (const key of item.citationKeys) links.push({ item_id: idByKey.get(item.itemKey)!, key, sha: citationHashByKey.get(key)! });
          if (links.length)
            await tx`
              insert into public.reference_item_citations (item_id, citation_id)
              select l.item_id::uuid, c.id
                from jsonb_to_recordset(${tx.json(links)}) as l(item_id text, key text, sha text)
                join public.reference_citations c on c.citation_key = l.key and c.content_sha256 = l.sha`;
        }
        await tx`
          update public.reference_datasets set status = 'published', published_at = now(), content_sha256 = ${p.contentSha256}
          where id = ${ds.id}`;
        if (latest?.status === "published") {
          await tx`update public.reference_datasets set status = 'retired' where id = ${latest.id}`;
        }
        console.log(`${p.kind}/${p.name}: published v${version} with ${p.items.length} items (sha256 ${p.contentSha256.slice(0, 12)}).`);
      }
    });
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
});
