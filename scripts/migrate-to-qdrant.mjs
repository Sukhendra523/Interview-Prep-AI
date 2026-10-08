import fs from "node:fs";
import path from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";

// Load .env.local
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

const qdrantUrl = process.env.QDRANT_URL;
const qdrantApiKey = process.env.QDRANT_API_KEY;
const collectionName = (process.env.QDRANT_COLLECTION && process.env.QDRANT_COLLECTION.trim()) || "notion_interview_notes";

if (!qdrantUrl || !qdrantApiKey) {
  console.error("❌ Error: Missing QDRANT_URL or QDRANT_API_KEY in .env.local.");
  console.error("Please add the following to your .env.local:");
  console.error("  QDRANT_URL=https://<your-cluster-id>.cloud.qdrant.io:6333");
  console.error("  QDRANT_API_KEY=<your-api-key>");
  process.exit(1);
}

const indexPath = path.resolve(process.cwd(), "data", "notion-index.json");
if (!fs.existsSync(indexPath)) {
  console.error(`❌ Error: Local file not found: ${indexPath}`);
  console.error("Run `npm run sync` first to generate your initial index.");
  process.exit(1);
}

const chunks = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
if (!Array.isArray(chunks) || !chunks.length) {
  console.error("❌ Error: data/notion-index.json is empty.");
  process.exit(1);
}

async function migrate() {
  console.log(`🚀 Starting migration of ${chunks.length} chunks to Qdrant Cloud...`);
  console.log(`🌐 Target Qdrant URL: ${qdrantUrl}`);
  console.log(`📦 Collection: "${collectionName}"`);

  const client = new QdrantClient({
    url: qdrantUrl,
    apiKey: qdrantApiKey,
    checkCompatibility: false,
  });

  const vectorSize = chunks[0].embedding?.length || 768;
  console.log(`📐 Detected embedding dimension: ${vectorSize}`);

  const exists = await client.collectionExists(collectionName);
  if (exists.exists) {
    console.log(`♻️  Recreating existing collection "${collectionName}"...`);
    await client.recreateCollection(collectionName, {
      vectors: { size: vectorSize, distance: "Cosine" },
    });
  } else {
    console.log(`✨ Creating collection "${collectionName}"...`);
    await client.createCollection(collectionName, {
      vectors: { size: vectorSize, distance: "Cosine" },
    });
  }

  const batchSize = 100;
  const totalBatches = Math.ceil(chunks.length / batchSize);

  for (let i = 0; i < chunks.length; i += batchSize) {
    const currentBatchNum = Math.floor(i / batchSize) + 1;
    const batch = chunks.slice(i, i + batchSize);
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

    process.stdout.write(`  ⬆️  Uploading batch ${currentBatchNum}/${totalBatches} (${points.length} points)... `);
    await client.upsert(collectionName, {
      wait: true,
      points,
    });
    console.log("✓");
  }

  console.log(`\n🎉 Success! Successfully migrated all ${chunks.length} chunks to Qdrant Cloud!`);
  console.log(`Your PrepMind RAG agent is now powered by Qdrant Cloud!`);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
