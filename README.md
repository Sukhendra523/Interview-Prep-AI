# PrepMind — Notion Interview Notes AI Agent

PrepMind is a free, grounded **Retrieval-Augmented Generation (RAG)** application built with Next.js 15, Ollama, and **Qdrant Cloud Vector Database**. It grounds its answers exclusively on your personal Notion interview-preparation notes, providing exact citations and direct links back to your Notion pages. If the notes do not contain the answer, it tells you plainly instead of hallucinating.

---

## 🏗️ Architecture

```text
┌─────────────────┐       /api/sync        ┌───────────────────────┐       Embeddings       ┌────────────────────────┐
│  Notion Notes   │ ─────────────────────> │ Recursive Block Parser │ ─────────────────────> │    nomic-embed-text    │
└─────────────────┘                        └───────────────────────┘                        └───────────┬────────────┘
                                                                                                        │
                                                                                                        ▼
┌─────────────────┐       /api/ask         ┌───────────────────────┐      Vector Search     ┌────────────────────────┐
│   User Prompt   │ ─────────────────────> │  Qdrant Vector Search │ <────────────────────  │  Qdrant Cloud Cluster  │
└─────────────────┘                        │ (or local JSON backup)│                        │(or data/notion-index)  │
                                           └──────────┬────────────┘                        └────────────────────────┘
                                                      │
                                                      ▼ Top Context
                                           ┌───────────────────────┐
                                           │       qwen2.5:3b      │ ───> Grounded Answer + Citations
                                           └───────────────────────┘
```

---

## 📋 Prerequisites

Before starting, make sure you have:

1. **Node.js** (v18.18+ or v20+) installed: [nodejs.org](https://nodejs.org)
2. **Ollama** installed on your machine: [ollama.com/download](https://ollama.com/download)
3. A **Notion** account: [notion.so](https://notion.so)
4. A free **Qdrant Cloud** account: [cloud.qdrant.io](https://cloud.qdrant.io) (100% free forever 1GB cluster, no credit card required)
5. *(Optional — for remote/Vercel deployment)* A free [Ngrok](https://ngrok.com) account.

---

## 🚀 Quickstart Guide (Local Development)

Follow these step-by-step instructions to get the app running locally:

### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/Sukhendra523/Interview-Prep-AI.git
cd "Interview Prep AI"
npm install
```

---

### Step 2: Install & Pull Ollama Models

#### Step 2.1 Install Ollama ( if not installed in your machine)

```bash
# Download Ollama from https://ollama.com/download
# Follow the instructions for your operating system
```

#### Step 2.2 Pull Ollama Models

Open your terminal and pull the two free models used by PrepMind:

```bash
# 1. Embedding model for semantic search
ollama pull nomic-embed-text

# 2. Fast, lightweight LLM for grounded answers
ollama pull qwen2.5:3b
```

Verify that Ollama is running and the models are available:
```bash
ollama --version

```

OR

curl http://localhost:11434
If it works, it returns the message: "Ollama is running"


> **Note for Windows users**: Ollama runs automatically in the background system tray. If `ollama serve` shows an address in-use error, Ollama is already active and ready.

---

### Step 3: Set Up Your Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) and click **New integration**.
2. Name it (e.g., `PrepMind Agent`) and click **Save**.
3. Copy the **Internal Integration Secret** (starts with `ntn_...` or `secret_...`).
4. In Notion, open your **Interview Preparation** parent page.
5. Click the `···` (top-right menu) → **Connections** → Search for and connect your integration (`PrepMind Agent`).
6. Copy the **Page ID** from your Notion page URL:
   * URL format: `https://notion.so/<workspace>/<Page-Name>-<32-character-page-id>`
   * Example Page ID: `6c3979b889f64ed98748dd79b621ccd0`

---

### Step 4: Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local
```

Fill in your variables in `.env.local`:

```ini
# Notion Configuration
NOTION_TOKEN=ntn_your_secret_token_here
NOTION_ROOT_PAGE_ID=your_32_character_page_id_here

# Local AI Models (Ollama)
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_LOCAL_URL=http://127.0.0.1:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_CHAT_MODEL=qwen2.5:3b

# Free Cloud Vector Database (Qdrant Cloud - https://cloud.qdrant.io)
QDRANT_URL=https://your-cluster-id.cloud.qdrant.io:6333
QDRANT_API_KEY=your_qdrant_api_key_here
QDRANT_COLLECTION=notion_interview_notes

# Optional Secret Token for Remote Proxy (if tunneling)
PROXY_PORT=11435
OLLAMA_PROXY_SECRET=your_custom_password_here
OLLAMA_API_KEY=your_custom_password_here
```

---

### Step 5: Set Up Qdrant Cloud & Instant Migration (One-Time)

1. Sign up for free at [cloud.qdrant.io](https://cloud.qdrant.io) (Free tier with 1GB RAM cluster, free forever, no credit card required).
2. Create a cluster and copy your **Cluster URL** and **API Key** into `.env.local`.
3. If you already have existing local notes in `data/notion-index.json`, upload all vectors directly to Qdrant Cloud in ~3 seconds without re-crawling Notion or re-running Ollama:

```bash
npm run migrate:qdrant
```

---

### Step 6: Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Step 7: Sync Your Notion Notes & Update Knowledge Base

Whenever you add or update notes in Notion, you can update your Qdrant Cloud RAG knowledge base anytime using any of the following methods:

#### Method A: From the Web UI (Easiest)
1. Start the app (`npm run dev`) and navigate to [http://localhost:3000](http://localhost:3000).
2. *(If tunneling via proxy)* In a separate terminal window, ensure the proxy is running:
```bash
npm run proxy
```
3. Click the **"↻ Sync Notes"** button in the top navigation bar.
4. The app will recursively crawl Notion, compute embeddings via Ollama, push the points straight to **Qdrant Cloud** (and save a local backup), and display a success notification.

#### Method B: Standalone Terminal Command (No Dev Server Needed)
In your terminal, run:
```bash
npm run sync
```
Or specify a custom Notion URL / Page ID:
```bash
node scripts/sync-kb.mjs https://notes-by-sukhendra.notion.site/Interview-Preparation-6c3979b889f64ed98748dd79b621ccd0
```

#### Method C: Via API Endpoint
While `npm run dev` is running:

**On Windows (PowerShell):**
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/sync
```

**On macOS / Linux (Terminal):**
```bash
curl -X POST http://localhost:3000/api/sync
```

*(You can also pass `{"url": "https://notes-by-sukhendra.notion.site/..."}` in the JSON body, or visit `http://localhost:3000/api/sync` directly in your browser).*

All passages are indexed straight into your **Qdrant Cloud cluster** with a local copy saved to `data/notion-index.json`!

---

## 🌐 Production Deployment Guide (Vercel + Secure Tunnel)

Since Vercel runs in the cloud and cannot reach your laptop's `localhost:11434` directly, PrepMind includes a built-in authenticated proxy (`scripts/ollama-proxy.mjs`) so you can securely expose your local Ollama instance.

### 1. Start the Auth Proxy
In a new terminal window:
```bash
npm run proxy
```
*This starts a reverse proxy on port `11435` that rejects any request lacking `Authorization: Bearer <OLLAMA_API_KEY>`.*

### 2. Expose Port 11435 via Ngrok
Claim your free static domain at [ngrok.com](https://dashboard.ngrok.com/endpoints) and start the tunnel:
```bash
ngrok http 11435 --domain=your-subdomain.ngrok-free.dev
```

### 3. Deploy to Vercel
1. Push your project to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import your repository.
3. Add the following **Environment Variables** in Vercel:
   * `OLLAMA_BASE_URL`: `https://your-subdomain.ngrok-free.dev`
   * `OLLAMA_API_KEY`: *(The same value you set in `OLLAMA_PROXY_SECRET`)*
   * `OLLAMA_EMBED_MODEL`: `nomic-embed-text`
   * `OLLAMA_CHAT_MODEL`: `qwen2.5:3b`
   * `NOTION_TOKEN`: `ntn_...`
   * `NOTION_ROOT_PAGE_ID`: `your_page_id`
   * `QDRANT_URL`: `https://your-cluster-id.cloud.qdrant.io:6333`
   * `QDRANT_API_KEY`: `your_qdrant_api_key_here`
   * `QDRANT_COLLECTION`: `notion_interview_notes`
4. Click **Deploy**. *(Because your vectors reside in Qdrant Cloud, your deployed Vercel app performs vector search directly in the cloud!)*

---

## 🛠️ Project Structure

```text
├── app/
│   ├── api/
│   │   ├── ask/route.ts          # RAG retrieval and Qwen 2.5 answer endpoint
│   │   └── sync/route.ts         # Notion crawler & Qdrant/local embedding sync
│   ├── layout.tsx                # Root layout and metadata
│   ├── page.tsx                  # PrepMind chat interface (with 1-click sync)
│   └── styles.css                # Tailored editorial design system
├── data/
│   └── notion-index.json         # Local embeddings & text chunks backup
├── lib/
│   ├── local-rag.ts              # Cosine similarity search & Ollama API client
│   └── vector-store.ts           # Qdrant Cloud vector database client & search
├── scripts/
│   ├── migrate-to-qdrant.mjs     # Instant local-to-Qdrant migration script
│   ├── ollama-proxy.mjs          # Bearer-token authentication reverse proxy
│   └── sync-kb.mjs               # Standalone Notion-to-Qdrant sync script
├── .env.example                  # Environment variables template
└── package.json                  # Dependencies and scripts
```

---

## ❓ Troubleshooting

| Issue | Solution |
| :--- | :--- |
| **`Error: listen tcp 127.0.0.1:11434: bind: address already in use`** | Ollama is already running as a background service on your OS. You do not need to run `ollama serve`. |
| **`Unauthorized: Invalid or missing token`** | Verify that `OLLAMA_API_KEY` in `.env.local` / Vercel matches `OLLAMA_PROXY_SECRET` in `scripts/ollama-proxy.mjs`. |
| **`No readable text was found` during sync** | Ensure that you opened the Notion page, clicked `···` → **Connections**, and added your integration. |
| **`Your notes have not been indexed yet`** | Run `Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/sync` (or verify that `data/notion-index.json` is committed to GitHub for Vercel). |
| **Ngrok tunnel forwards to port 80** | Make sure you specify the port explicitly: `ngrok http 11435 --domain=...`. |

---

## 📄 License

MIT License. Grounded, private, and powered by your own Notion knowledge base.
