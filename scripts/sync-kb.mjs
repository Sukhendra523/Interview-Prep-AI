import fs from "node:fs";
import path from "node:path";
import { Client } from "@notionhq/client";
import { QdrantClient } from "@qdrant/js-client-rest";

// 1. Load environment variables from .env.local
try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2]?.trim().replace(/^['"]|['"]$/g, "") || "";
      }
    }
  }
} catch (e) {
  console.warn("Could not read .env.local:", e.message);
}

function extractNotionId(input) {
  if (!input) return null;
  const clean = input.trim();
  const match32 = clean.match(/([0-9a-f]{32})(?:[/?#]|$)/i);
  if (match32) return match32[1].toLowerCase();
  const matchUuid = clean.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (matchUuid) return matchUuid[1].replace(/-/g, "").toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(clean)) return clean.toLowerCase();
  return null;
}

const argInput = process.argv[2];
const rootPageId = extractNotionId(argInput) || extractNotionId(process.env.NOTION_ROOT_PAGE_ID);
const notionToken = process.env.NOTION_TOKEN;

if (!notionToken) {
  console.error("❌ Error: NOTION_TOKEN is not defined in .env.local.");
  process.exit(1);
}

if (!rootPageId) {
  console.error("❌ Error: Could not determine Notion Root Page ID.");
  console.error("Provide a URL or Page ID as argument, or set NOTION_ROOT_PAGE_ID in .env.local.");
  console.error("Example: node scripts/sync-kb.mjs https://notes-by-sukhendra.notion.site/Interview-Preparation-6c3979b889f64ed98748dd79b621ccd0");
  process.exit(1);
}

const primaryOllamaUrl = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
const localOllamaUrl = (process.env.OLLAMA_LOCAL_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const embedModel = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const apiKey = (process.env.OLLAMA_API_KEY || "").trim();

async function callOllama(endpoint, body) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const urls = Array.from(new Set([primaryOllamaUrl, localOllamaUrl].filter(Boolean)));
  let lastErr = null;

  for (const baseUrl of urls) {
    try {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama status ${res.status} from ${baseUrl}: ${text}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("Failed to connect to Ollama.");
}

async function embedTexts(texts) {
  const res = await callOllama("/api/embed", { model: embedModel, input: texts });
  return res.embeddings;
}

const textOf = (value) => {
  const fragments = value?.rich_text ?? value?.title ?? [];
  return Array.isArray(fragments) ? fragments.map((item) => item?.plain_text ?? "").join("") : "";
};

const blockText = (block) => {
  const payload = block[block.type];
  if (!payload) return "";
  if (block.type === "child_page" || block.type === "child_database") return "";
  if (block.type === "to_do") return `${payload.checked ? "[x]" : "[ ]"} ${textOf(payload)}`;
  if (block.type === "heading_1") return `# ${textOf(payload)}`;
  if (block.type === "heading_2") return `## ${textOf(payload)}`;
  if (block.type === "heading_3") return `### ${textOf(payload)}`;
  if (block.type === "bulleted_list_item") return `• ${textOf(payload)}`;
  if (block.type === "numbered_list_item") return `1. ${textOf(payload)}`;
  if (block.type === "quote") return `> ${textOf(payload)}`;
  if (block.type === "callout") return `💡 ${textOf(payload)}`;
  if (block.type === "code") return textOf(payload);
  return textOf(payload);
};

async function collectBlocks(notion, blockId, depth = 0) {
  if (depth > 6) return { lines: [], childIds: [] };
  let cursor;
  const lines = [];
  const childIds = [];

  do {
    let response;
    try {
      response = await notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });
    } catch (err) {
      console.warn(`  ⚠️ Skipped inaccessible block ${blockId}: ${err.message}`);
      break;
    }

    for (const block of response?.results || []) {
      if (block.type === "child_page") {
        childIds.push(block.id);
      } else if (block.type === "child_database") {
        try {
          let dbCursor;
          do {
            const dbRes = await notion.databases.query({
              database_id: block.id,
              start_cursor: dbCursor,
              page_size: 100,
            });
            for (const row of dbRes.results) {
              childIds.push(row.id);
            }
            dbCursor = dbRes.has_more ? dbRes.next_cursor : undefined;
          } while (dbCursor);
        } catch (e) {
          console.warn(`  ⚠️ Could not query database ${block.id}:`, e.message);
        }
      } else {
        const line = blockText(block);
        if (line) lines.push(line);
        if (block.has_children) {
          try {
            const nested = await collectBlocks(notion, block.id, depth + 1);
            lines.push(...nested.lines);
            childIds.push(...nested.childIds);
          } catch (nestedErr) {
            console.warn(`  ⚠️ Skipped nested child block ${block.id}:`, nestedErr.message);
          }
        }
      }
    }
    cursor = response?.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return { lines, childIds };
}

function chunks(page) {
  const size = 900, overlap = 160;
  if (page.content.length <= size) return [page];
  const result = [];
  for (let start = 0; start < page.content.length; start += size - overlap) {
    result.push({ ...page, content: page.content.slice(start, start + size) });
  }
  return result;
}

async function main() {
  console.log(`🚀 Starting Notion Knowledge Base Sync...`);
  console.log(`📌 Root Page ID: ${rootPageId}`);
  const notion = new Client({ auth: notionToken });

  const pages = [];
  const visited = new Set();

  const visit = async (pageId) => {
    const cleanId = pageId.replace(/-/g, "");
    if (visited.has(cleanId)) return;
    visited.add(cleanId);

    try {
      const page = await notion.pages.retrieve({ page_id: pageId });
      const titleProperty = Object.values(page.properties || {}).find((prop) => prop.type === "title");
      const title = textOf(titleProperty) || "Untitled note";

      process.stdout.write(`  📄 Crawling "${title}"... `);
      const { lines, childIds } = await collectBlocks(notion, pageId);
      console.log(`(${lines.length} lines, ${childIds.length} sub-items)`);

      pages.push({
        pageId: cleanId,
        title,
        url: page.url || `https://www.notion.so/${cleanId}`,
        content: lines.join("\n"),
      });

      for (const child of childIds) {
        await visit(child);
      }
    } catch (err) {
      console.log(`❌ Error retrieving page ${pageId}: ${err.message}`);
    }
  };

  await visit(rootPageId);

  const passages = pages.flatMap(chunks).filter((item) => item.content.trim().length > 20);
  console.log(`\n📊 Crawl finished: ${pages.length} pages found, ${passages.length} passages created.`);

  if (!passages.length) {
    console.error("⚠️ No readable text found. Ensure the parent page is shared with your Notion integration.");
    process.exit(1);
  }

  console.log(`🧠 Generating embeddings with Ollama (${embedModel})...`);
  const batchSize = 20;
  const allEmbeddings = [];

  for (let i = 0; i < passages.length; i += batchSize) {
    const batch = passages.slice(i, i + batchSize).map((item) => item.content);
    process.stdout.write(`  Computing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(passages.length / batchSize)}... `);
    const embBatch = await embedTexts(batch);
    allEmbeddings.push(...embBatch);
    console.log(`✓`);
  }

  const indexedChunks = passages.map((item, i) => ({
    ...item,
    embedding: allEmbeddings[i],
  }));

  const outPath = path.resolve(process.cwd(), "data", "notion-index.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(indexedChunks, null, 2), "utf-8");
  console.log(`\n💾 Saved local backup: ${indexedChunks.length} chunks to data/notion-index.json`);

  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  const collectionName = (process.env.QDRANT_COLLECTION && process.env.QDRANT_COLLECTION.trim()) || "notion_interview_notes";

  if (qdrantUrl && qdrantApiKey) {
    console.log(`\n☁️  Syncing to Qdrant Cloud: ${qdrantUrl}...`);
    try {
      const qdrant = new QdrantClient({ url: qdrantUrl, apiKey: qdrantApiKey, checkCompatibility: false });
      const vectorSize = indexedChunks[0]?.embedding?.length || 768;
      const exists = await qdrant.collectionExists(collectionName);
      if (exists.exists) {
        await qdrant.recreateCollection(collectionName, { vectors: { size: vectorSize, distance: "Cosine" } });
      } else {
        await qdrant.createCollection(collectionName, { vectors: { size: vectorSize, distance: "Cosine" } });
      }

      const qdrantBatchSize = 100;
      for (let i = 0; i < indexedChunks.length; i += qdrantBatchSize) {
        const batch = indexedChunks.slice(i, i + qdrantBatchSize);
        const points = batch.map((chunk, idx) => ({
          id: i + idx + 1,
          vector: chunk.embedding,
          payload: {
            pageId: chunk.pageId,
            title: chunk.title,
            url: chunk.url,
            content: chunk.content,
          },
        }));
        await qdrant.upsert(collectionName, { wait: true, points });
      }
      console.log(`🎉 Success! Synced ${indexedChunks.length} chunks to Qdrant Cloud collection "${collectionName}"!`);
    } catch (err) {
      console.error(`⚠️ Qdrant Cloud upload failed:`, err.message);
    }
  } else {
    console.log(`ℹ️  Note: QDRANT_URL is not configured in .env.local. Saved to local backup.`);
  }

  console.log(`\n✅ RAG knowledge base is now up to date with your latest Notion notes!`);
}

main().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
