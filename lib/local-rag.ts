import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type IndexedChunk = { pageId: string; title: string; url: string; content: string; embedding: number[] };
const indexPath = path.join(process.cwd(), "data", "notion-index.json");
const primaryUrl = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
const localUrl = (process.env.OLLAMA_LOCAL_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const embedModel = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const chatModel = process.env.OLLAMA_CHAT_MODEL || "qwen2.5:3b";

async function ollama(endpoint: string, body: object) {
  const apiKey = (process.env.OLLAMA_API_KEY || "").trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const urlsToTry = Array.from(new Set([primaryUrl, localUrl].filter(Boolean)));
  let lastError: any = null;

  for (const url of urlsToTry) {
    try {
      const response = await fetch(`${url}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error ${response.status} from ${url}: ${errorText}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      // If there are other URLs to try, continue fallback
    }
  }

  throw lastError || new Error("Failed to connect to Ollama.");
}
export async function embed(input: string | string[]) { return (await ollama("/api/embed", { model: embedModel, input })).embeddings as number[][]; }
export async function answer(question: string, context: string) {
  const result = await ollama("/api/chat", {
    model: chatModel, stream: false, keep_alive: "10m", messages: [
      { role: "system", content: "You are PrepMind, an interview-notes assistant. Answer only from the supplied note excerpts. If the excerpts do not answer the question, say exactly: 'I couldn’t find an answer to that in your current interview notes.' Be concise, useful, and never invent facts or sources." },
      { role: "user", content: `Question: ${question}\n\nNote excerpts:\n${context}` }
    ]
  });
  return String(result.message?.content || "I couldn’t find an answer to that in your current interview notes.").trim();
}
export async function readIndex(): Promise<IndexedChunk[]> { try { return JSON.parse(await readFile(indexPath, "utf8")); } catch { return []; } }
export async function writeIndex(chunks: IndexedChunk[]) { await mkdir(path.dirname(indexPath), { recursive: true }); await writeFile(indexPath, JSON.stringify(chunks), "utf8"); }
export function cosine(a: number[], b: number[]) { let dot = 0, aMag = 0, bMag = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aMag += a[i] ** 2; bMag += b[i] ** 2; } return dot / (Math.sqrt(aMag) * Math.sqrt(bMag)); }
