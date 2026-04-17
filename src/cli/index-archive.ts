import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { readConfig, type Config } from "../config.ts";
import { embed, vectorizeUpsert } from "../providers/vectorize.ts";

/**
 * Ingest a directory of .md articles into Cloudflare Vectorize.
 * Each file becomes one vector with metadata { title, publishedAt, snippet }.
 *
 * Dimensions: 768 (text-embedding-3-small truncated). User's Vectorize index
 * must be provisioned with `dimensions=768 metric=cosine`. The pre-flight log
 * surfaces this so first-run users don't trip on a dimension mismatch.
 *
 * `configOverride` is exposed for tests to bypass readConfig(); production
 * callers should omit it and rely on ~/.checkapp/config.json.
 */
export async function indexArchive(dir: string, configOverride?: Config): Promise<void> {
  const config = configOverride ?? readConfig();
  const pc = config.providers?.["self-plagiarism"];
  if (!pc?.apiKey || !pc.extra?.accountId) {
    throw new Error(
      "self-plagiarism provider not configured. Add providers['self-plagiarism'] " +
      "= { provider: 'cloudflare-vectorize', apiKey: '<token>', extra: { accountId: '<id>', indexName: 'articles' } } " +
      "to your ~/.checkapp/config.json."
    );
  }
  if (!config.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY required for embeddings. Add it to your .env or config.");
  }

  const indexName = pc.extra.indexName ?? "articles";
  const files = readdirSync(dir).filter(f => f.endsWith(".md"));
  if (files.length === 0) {
    console.log(`No .md files found in ${dir}`);
    return;
  }

  console.log(`Embedding ${files.length} article(s) at 768 dimensions...`);
  console.log(`(If this is your first run, your Vectorize index must be created with matching dims:)`);
  console.log(`  wrangler vectorize create ${indexName} --dimensions=768 --metric=cosine\n`);

  const batch: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }> = [];
  for (const file of files) {
    const full = join(dir, file);
    const content = readFileSync(full, "utf-8");
    const stat = statSync(full);
    const vec = await embed(content, config.openrouterApiKey);
    batch.push({
      id: file.replace(/\.md$/, ""),
      values: vec,
      metadata: {
        title: file,
        publishedAt: stat.mtime.toISOString(),
        snippet: content.slice(0, 200),
      },
    });
    console.log(`  embedded ${file} (${vec.length} dims)`);
  }

  // Cloudflare Vectorize v2 caps upsert at 1000 vectors/request + body-size limit.
  // 500 keeps us well under both with headroom for metadata payloads.
  const UPSERT_BATCH_SIZE = 500;
  console.log(`Upserting ${batch.length} vector(s) to index '${indexName}' in chunks of ${UPSERT_BATCH_SIZE}...`);
  for (let i = 0; i < batch.length; i += UPSERT_BATCH_SIZE) {
    const chunk = batch.slice(i, i + UPSERT_BATCH_SIZE);
    await vectorizeUpsert({
      accountId: pc.extra.accountId,
      indexName,
      apiKey: pc.apiKey,
      vectors: chunk,
    });
    console.log(`  upserted ${i + chunk.length}/${batch.length}`);
  }
  console.log(`Indexed ${batch.length} article(s). Ready for self-plagiarism checks.`);
}
