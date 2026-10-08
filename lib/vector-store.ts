import { QdrantClient } from "@qdrant/js-client-rest";
import { cosine, IndexedChunk, readIndex, writeIndex } from "./local-rag";

export const QDRANT_COLLECTION = (process.env.QDRANT_COLLECTION && process.env.QDRANT_COLLECTION.trim()) || "notion_interview_notes";

export function isQdrantConfigured(): boolean {
  return Boolean(process.env.QDRANT_URL && process.env.QDRANT_API_KEY);
}

function getQdrantClient(): QdrantClient {
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url || !apiKey) {
    throw new Error("Missing QDRANT_URL or QDRANT_API_KEY in environment.");
  }

  return new QdrantClient({
    url,
    apiKey,
    checkCompatibility: false,
  });
}

/**
 * Saves chunks to Qdrant Cloud vector database (and keeps a local backup).
 * If Qdrant is not configured, it saves directly to local storage.
 */
export async function saveChunks(chunks: IndexedChunk[]): Promise<{ target: "qdrant" | "local"; count: number }> {
  // Always keep a local file backup
  await writeIndex(chunks);

  if (!isQdrantConfigured()) {
    console.log(`[VectorStore] Qdrant not configured. Saved ${chunks.length} chunks to local JSON.`);
    return { target: "local", count: chunks.length };
  }

  const client = getQdrantClient();
  const collectionName = QDRANT_COLLECTION;
  const vectorSize = chunks[0]?.embedding?.length || 768;

  console.log(`[VectorStore] Connecting to Qdrant Cloud at ${process.env.QDRANT_URL}...`);

  // Ensure collection exists with correct vector size and Cosine distance
  const exists = await client.collectionExists(collectionName);
  if (exists.exists) {
    // Recreate collection so that stale or deleted Notion notes are cleaned up
    await client.recreateCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  } else {
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  }

  // Upload points in batches of 100
  const batchSize = 100;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const points = batch.map((chunk, batchIdx) => ({
      id: i + batchIdx + 1,
      vector: chunk.embedding,
      payload: {
        pageId: chunk.pageId,
        title: chunk.title,
        url: chunk.url,
        content: chunk.content,
      },
    }));

    await client.upsert(collectionName, {
      wait: true,
      points,
    });
  }

  console.log(`[VectorStore] Successfully synced ${chunks.length} chunks to Qdrant Cloud collection "${collectionName}".`);
  return { target: "qdrant", count: chunks.length };
}

export type SearchResultChunk = {
  pageId: string;
  title: string;
  url: string;
  content: string;
  similarity: number;
};

/**
 * Searches relevant chunks for a question.
 * Uses Qdrant Cloud vector search if configured; otherwise falls back to local cosine calculation.
 */
export async function searchRelevantChunks(
  queryEmbedding: number[],
  limit = 6,
  scoreThreshold = 0.42
): Promise<SearchResultChunk[]> {
  if (isQdrantConfigured()) {
    try {
      const client = getQdrantClient();
      const response = await client.query(QDRANT_COLLECTION, {
        query: queryEmbedding,
        limit,
        score_threshold: scoreThreshold,
        with_payload: true,
      });

      return (response.points || []).map((pt: any) => ({
        pageId: String(pt.payload?.pageId || ""),
        title: String(pt.payload?.title || "Untitled note"),
        url: String(pt.payload?.url || ""),
        content: String(pt.payload?.content || ""),
        similarity: pt.score ?? 0,
      }));
    } catch (err: any) {
      console.warn(`[VectorStore] Qdrant search failed, falling back to local index: ${err.message}`);
    }
  }

  // Fallback: search in local notion-index.json
  const index = await readIndex();
  if (!index.length) return [];

  return index
    .map((chunk) => ({
      pageId: chunk.pageId,
      title: chunk.title,
      url: chunk.url,
      content: chunk.content,
      similarity: cosine(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .filter((item) => item.similarity >= scoreThreshold);
}
