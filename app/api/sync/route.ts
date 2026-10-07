import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";
import { embed, writeIndex } from "@/lib/local-rag";

export const runtime = "nodejs";
type PageChunk = { pageId: string; title: string; url: string; content: string };
// Notion uses rich_text for blocks and title for page properties. Some block
// payloads also contain scalar metadata, so only iterate when the field is a
// true rich-text array.
const textOf = (value: any) => {
  const fragments = value?.rich_text ?? value?.title ?? [];
  return Array.isArray(fragments) ? fragments.map((item: any) => item?.plain_text ?? "").join("") : "";
};
const blockText = (block: any) => {
  const payload = block[block.type];
  if (block.type === "child_page") return "";
  if (block.type === "to_do") return `${payload.checked ? "[x]" : "[ ]"} ${textOf(payload)}`;
  if (block.type === "code") return textOf(payload);
  return textOf(payload);
};
function chunks(page: PageChunk): PageChunk[] {
  const size = 900, overlap = 160;
  if (page.content.length <= size) return [page];
  const result: PageChunk[] = [];
  for (let start = 0; start < page.content.length; start += size - overlap) result.push({ ...page, content: page.content.slice(start, start + size) });
  return result;
}

export async function POST(request: Request) {
  try {
    const key = request.headers.get("x-sync-key");
    if (process.env.SYNC_SECRET && key !== process.env.SYNC_SECRET) return NextResponse.json({ error: "Unauthorized sync request." }, { status: 401 });
    if (!process.env.NOTION_TOKEN || !process.env.NOTION_ROOT_PAGE_ID) return NextResponse.json({ error: "Add NOTION_TOKEN and NOTION_ROOT_PAGE_ID to .env.local first." }, { status: 503 });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const pages: PageChunk[] = [];
    const visit = async (pageId: string) => {
      const page: any = await notion.pages.retrieve({ page_id: pageId });
      const titleProperty = Object.values(page.properties || {}).find((prop: any) => prop.type === "title") as any;
      const title = textOf(titleProperty) || "Untitled note";
      let cursor: string | undefined; const lines: string[] = []; const children: string[] = [];
      do {
        const response: any = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
        for (const block of response.results) { if (block.type === "child_page") children.push(block.id); else { const line = blockText(block); if (line) lines.push(line); } }
        cursor = response.has_more ? response.next_cursor : undefined;
      } while (cursor);
      pages.push({ pageId, title, url: page.url || `https://www.notion.so/${pageId.replaceAll("-", "")}`, content: lines.join("\n") });
      for (const child of children) await visit(child);
    };
    await visit(process.env.NOTION_ROOT_PAGE_ID);
    const passages = pages.flatMap(chunks).filter((item) => item.content.trim().length > 20);
    if (!passages.length) return NextResponse.json({ error: "No readable text was found. Make sure the Notion page is shared with your integration." }, { status: 422 });
    const embeddings = await embed(passages.map((item) => item.content));
    await writeIndex(passages.map((item, i) => ({ ...item, embedding: embeddings[i] })));
    return NextResponse.json({ syncedPages: pages.length, indexedPassages: passages.length });
  } catch (error) {
    console.error("Notion sync failed", error);
    const detail = error instanceof Error ? error.message : "Unknown provider error";
    return NextResponse.json({
      error: "Sync failed. Check that the Notion page is shared with the integration and Ollama is running.",
      detail
    }, { status: 500 });
  }
}
