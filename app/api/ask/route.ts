import { NextResponse } from "next/server";
import { answer, cosine, embed, readIndex } from "@/lib/local-rag";

export const runtime = "nodejs";
const NOT_FOUND = "I couldn’t find an answer to that in your current interview notes. Try rephrasing your question, or add the topic to Notion and sync again.";

export async function POST(request: Request) {
  try {
    const { question } = await request.json();
    if (typeof question !== "string" || question.trim().length < 2) return NextResponse.json({ error: "Please enter a question." }, { status: 400 });
    const index = await readIndex();
    if (!index.length) return NextResponse.json({ error: "Your notes have not been indexed yet. Run the Notion sync first." }, { status: 503 });
    const [queryEmbedding] = await embed(question);
    const useful = index.map((chunk) => ({ ...chunk, similarity: cosine(queryEmbedding, chunk.embedding) })).sort((a, b) => b.similarity - a.similarity).slice(0, 6).filter((item) => item.similarity >= 0.42);
    if (!useful.length) return NextResponse.json({ answer: NOT_FOUND, sources: [], grounded: false });
    const context = useful.map((item, index) => `[${index + 1}] ${item.title}\n${item.content}`).join("\n\n");
    const response = await answer(question, context);
    const notFound = response.startsWith("I couldn’t find an answer");
    return NextResponse.json({ answer: response, grounded: !notFound, sources: notFound ? [] : useful.map((item) => ({ title: item.title, url: item.url, excerpt: item.content.slice(0, 150) + (item.content.length > 150 ? "…" : "") })) });
  } catch (error) {
    console.error("Ask route failed", error);
    return NextResponse.json({ error: "Unable to search your local notes. Make sure Ollama is running and both models are downloaded." }, { status: 500 });
  }
}
