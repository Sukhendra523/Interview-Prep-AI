"use client";

import { FormEvent, useState } from "react";

type Source = { title: string; url: string; excerpt: string };
type Answer = { answer: string; sources: Source[]; grounded: boolean };

const prompts = ["Explain the STAR method", "What should I say for ‘Tell me about yourself?’", "How do I prepare for an HR interview?"];

export default function Home() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  async function syncKnowledgeBase() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage("");
    setError("");
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://notes-by-sukhendra.notion.site/Interview-Preparation-6c3979b889f64ed98748dd79b621ccd0",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || "Sync failed.");
      const targetName = data.storageTarget === "qdrant" ? "Qdrant Cloud" : "knowledge base";
      setSyncMessage(`✓ Synced ${data.syncedPages} pages to ${targetName} (${data.indexedPassages} passages)`);
      setTimeout(() => setSyncMessage(""), 7000);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Unable to sync Notion notes.");
    } finally {
      setSyncing(false);
    }
  }

  async function ask(e?: FormEvent, suggested?: string) {
    e?.preventDefault();
    const query = suggested ?? question;
    if (!query.trim() || loading) return;
    setQuestion(query); setLoading(true); setError(""); setAnswer(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: query }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setAnswer(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to answer right now."); }
    finally { setLoading(false); }
  }

  return <main>
    <nav>
      <a className="brand" href="#top"><span>✦</span> PrepMind</a>
      <div className="nav-controls">
        {syncMessage && <span className="sync-success-pill">{syncMessage}</span>}
        <button
          onClick={syncKnowledgeBase}
          disabled={syncing}
          className="sync-btn"
          title="Fetch latest notes from Notion and rebuild RAG knowledge base"
        >
          {syncing ? <span className="spinner-small" /> : "↻"} {syncing ? "Updating RAG..." : "Sync Notes"}
        </button>
        <div className="status"><i /> Notes connected</div>
      </div>
    </nav>
    <section className="hero" id="top">
      <div className="eyebrow">YOUR PERSONAL INTERVIEW COPILOT</div>
      <h1>Ask your notes.<br /><em>Get interview-ready.</em></h1>
      <p>Clear, cited answers from your Notion preparation notes — nothing invented, nothing lost in a search.</p>
      <form onSubmit={ask} className="askbox">
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask anything from your interview notes…" rows={2} />
        <button disabled={loading || !question.trim()} aria-label="Ask question">{loading ? <span className="spinner" /> : "↑"}</button>
      </form>
      <div className="suggestions">{prompts.map((p) => <button key={p} onClick={() => ask(undefined, p)}>{p}</button>)}</div>
    </section>
    <section className="response" aria-live="polite">
      {loading && <div className="thinking"><span className="spark">✦</span><div><strong>Searching your notes</strong><p>Finding the most relevant context and sources…</p></div></div>}
      {error && <div className="error"><strong>Couldn’t reach your notes.</strong><p>{error}</p></div>}
      {answer && <article className={!answer.grounded ? "not-found" : ""}>
        <div className="answer-label">{answer.grounded ? "ANSWER FROM YOUR NOTES" : "NO MATCH FOUND"}</div>
        <div className="answer-text">{answer.answer}</div>
        {answer.sources.length > 0 && <div className="sources"><h2>References from your Notion</h2>{answer.sources.map((source, i) => <a className="source" key={source.url + i} href={source.url} target="_blank" rel="noreferrer"><span className="source-number">{String(i + 1).padStart(2, "0")}</span><span><strong>{source.title}</strong><small>{source.excerpt}</small></span><b>↗</b></a>)}</div>}
      </article>}
      {!loading && !answer && !error && <div className="empty"><span>✦</span><p>Your notes are ready when you are.<br />Start with a question above.</p></div>}
    </section>
    <footer><span>POWERED BY - <a className="origin-link" href="https://notes-by-sukhendra.notion.site/Interview-Preparation-6c3979b889f64ed98748dd79b621ccd0" target="_blank" rel="noreferrer">Notion Interview Preparation Notes by Sukhendra </a></span><span>Grounded answers · Always cited</span></footer>
  </main>;
}
