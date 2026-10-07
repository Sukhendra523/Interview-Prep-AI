# PrepMind — Notion interview-notes AI agent

A free, local RAG app that answers only from your interview-preparation notes. Every answer has links to the original Notion pages; when the notes do not contain an answer, it says so plainly instead of guessing.

## One-time setup

1. Install [Ollama](https://ollama.com/download), then download the two free local models:

   ```powershell
   ollama pull nomic-embed-text
   ollama pull qwen2.5:3b
   ```

2. Copy `.env.example` to `.env.local` and add your Notion integration secret.
3. In Notion, create an **internal integration** at `notion.so/my-integrations`, copy its secret into `NOTION_TOKEN`, and share the **Interview Preparation** page with that integration. The supplied page ID is already populated.
4. Install and run:

   ```powershell
   npm install
   npm run dev
   ```

5. Index your notes once (while `npm run dev` is running):

   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/sync
   ```

   For a deployed app, set a `SYNC_SECRET` in `.env.local` and send it in the `x-sync-key` header. This avoids exposing a Notion-sync endpoint publicly.

## Architecture

`Notion → /api/sync → local Ollama embeddings → local JSON index → /api/ask → cited response`

The sync route recursively indexes child pages, retains each source page URL, and saves embeddings to `data/notion-index.json` on your computer. The ask route uses a similarity threshold and a strict grounding prompt, so unrelated questions get the intended no-result message. Your note contents and prompts stay local, apart from the Notion sync.
