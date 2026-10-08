import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";
import { embed } from "@/lib/local-rag";
import { saveChunks } from "@/lib/vector-store";

export const runtime = "nodejs";
export const maxDuration = 300;

type PageChunk = { pageId: string; title: string; url: string; content: string };

function extractNotionId(input?: string | null): string | null {
  if (!input) return null;
  const clean = input.trim();
  // Check for 32 hex chars at the end of slug or anywhere in url
  const match32 = clean.match(/([0-9a-f]{32})(?:[/?#]|$)/i);
  if (match32) return match32[1].toLowerCase();
  // Check for UUID format (8-4-4-4-12)
  const matchUuid = clean.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (matchUuid) return matchUuid[1].replace(/-/g, "").toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(clean)) return clean.toLowerCase();
  return null;
}

const textOf = (value: any) => {
  const fragments = value?.rich_text ?? value?.title ?? [];
  return Array.isArray(fragments) ? fragments.map((item: any) => item?.plain_text ?? "").join("") : "";
};

const blockText = (block: any) => {
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

async function collectBlocks(notion: Client, blockId: string, depth = 0): Promise<{ lines: string[]; childIds: string[] }> {
  if (depth > 6) return { lines: [], childIds: [] };
  let cursor: string | undefined;
  const lines: string[] = [];
  const childIds: string[] = [];

  do {
    let response: any;
    try {
      response = await notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });
    } catch (err: any) {
      // Gracefully ignore blocks that are inaccessible or not shared with the integration
      console.warn(`[Sync] Skipped block ${blockId}: ${err?.message || err}`);
      break;
    }

    for (const block of response?.results || []) {
      if (block.type === "child_page") {
        childIds.push(block.id);
      } else if (block.type === "child_database") {
        try {
          let dbCursor: string | undefined;
          do {
            const dbRes: any = await notion.databases.query({
              database_id: block.id,
              start_cursor: dbCursor,
              page_size: 100,
            });
            for (const row of dbRes.results) {
              childIds.push(row.id);
            }
            dbCursor = dbRes.has_more ? dbRes.next_cursor : undefined;
          } while (dbCursor);
        } catch (e: any) {
          console.warn(`[Sync] Skipped child database ${block.id}:`, e?.message || e);
        }
      } else {
        const line = blockText(block);
        if (line) lines.push(line);
        if (block.has_children) {
          try {
            const nested = await collectBlocks(notion, block.id, depth + 1);
            lines.push(...nested.lines);
            childIds.push(...nested.childIds);
          } catch (nestedErr: any) {
            console.warn(`[Sync] Skipped child blocks of ${block.id}:`, nestedErr?.message || nestedErr);
          }
        }
      }
    }
    cursor = response?.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return { lines, childIds };
}

function chunks(page: PageChunk): PageChunk[] {
  const size = 900, overlap = 160;
  if (page.content.length <= size) return [page];
  const result: PageChunk[] = [];
  for (let start = 0; start < page.content.length; start += size - overlap) {
    result.push({ ...page, content: page.content.slice(start, start + size) });
  }
  return result;
}

async function handleSync(request: Request) {
  try {
    const key = request.headers.get("x-sync-key");
    if (process.env.SYNC_SECRET && key !== process.env.SYNC_SECRET) {
      return NextResponse.json({ error: "Unauthorized sync request." }, { status: 401 });
    }

    if (!process.env.NOTION_TOKEN) {
      return NextResponse.json(
        { error: "Missing NOTION_TOKEN in environment (.env.local)." },
        { status: 503 }
      );
    }

    // Determine target root page ID from body, query param, or env
    let requestedInput: string | null = null;
    const urlObj = new URL(request.url);
    requestedInput = urlObj.searchParams.get("url") || urlObj.searchParams.get("pageId");

    if (!requestedInput && request.method === "POST") {
      try {
        const body = await request.json();
        requestedInput = body?.url || body?.pageUrl || body?.pageId || null;
      } catch {
        // Optional JSON body
      }
    }

    const resolvedPageId = extractNotionId(requestedInput) || extractNotionId(process.env.NOTION_ROOT_PAGE_ID);

    if (!resolvedPageId) {
      return NextResponse.json(
        {
          error: "No Notion Page ID found. Provide a Notion URL / Page ID or set NOTION_ROOT_PAGE_ID in .env.local.",
        },
        { status: 400 }
      );
    }

    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const pages: PageChunk[] = [];
    const visited = new Set<string>();

    const visit = async (pageId: string) => {
      const cleanId = pageId.replace(/-/g, "");
      if (visited.has(cleanId)) return;
      visited.add(cleanId);

      try {
        const page: any = await notion.pages.retrieve({ page_id: pageId });
        const titleProperty = Object.values(page.properties || {}).find((prop: any) => prop.type === "title") as any;
        const title = textOf(titleProperty) || "Untitled note";

        const { lines, childIds } = await collectBlocks(notion, pageId);

        pages.push({
          pageId: cleanId,
          title,
          url: page.url || `https://www.notion.so/${cleanId}`,
          content: lines.join("\n"),
        });

        for (const child of childIds) {
          await visit(child);
        }
      } catch (err: any) {
        console.warn(`[Sync] Skipped page ${pageId}:`, err?.message || err);
      }
    };

    await visit(resolvedPageId);

    const passages = pages.flatMap(chunks).filter((item) => item.content.trim().length > 20);
    if (!passages.length) {
      return NextResponse.json(
        {
          error: "No readable text was found. Make sure the Notion page is shared with your integration.",
          syncedPages: pages.length,
        },
        { status: 422 }
      );
    }

    // Embed in batches of 20 to avoid timeouts
    const batchSize = 20;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < passages.length; i += batchSize) {
      const batch = passages.slice(i, i + batchSize).map((item) => item.content);
      const embBatch = await embed(batch);
      allEmbeddings.push(...embBatch);
    }

    const saveResult = await saveChunks(passages.map((item, i) => ({ ...item, embedding: allEmbeddings[i] })));

    return NextResponse.json({
      success: true,
      message:
        saveResult.target === "qdrant"
          ? "RAG knowledge base successfully synced to Qdrant Cloud vector database!"
          : "RAG knowledge base successfully updated (saved to local backup).",
      storageTarget: saveResult.target,
      rootPageId: resolvedPageId,
      syncedPages: pages.length,
      indexedPassages: passages.length,
      pages: pages.map((p) => ({ title: p.title, url: p.url })),
    });
  } catch (error) {
    console.error("Notion sync failed:", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Sync failed. Check that the Notion page is shared with your integration and Ollama is running.",
        detail,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return handleSync(request);
}

export async function GET(request: Request) {
  return handleSync(request);
}
