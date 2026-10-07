import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type IndexedChunk = { pageId: string; title: string; url: string; content: string; embedding: number[] };
const indexPath = path.join(process.cwd(), "data", "notion-index.json");
const ollamaUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, "");
const embedModel = process.env.OLLAMA_EMBED_MODEL;
const chatModel = process.env.OLLAMA_CHAT_MODEL;

async function ollama(endpoint: string, body: object) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.OLLAMA_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }
  const response = await fetch(`${ollamaUrl}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Ollama error ${response.status}: ${await response.text()}`);
  return response.json();
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
