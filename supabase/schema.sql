create extension if not exists vector;

create table if not exists notion_chunks (
  id uuid primary key default gen_random_uuid(),
  notion_page_id text not null,
  title text not null,
  url text not null,
  content text not null,
  embedding vector(1536) not null,
  updated_at timestamptz default now()
);

create index if not exists notion_chunks_embedding_idx
  on notion_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function match_notion_chunks(query_embedding vector(1536), match_count int default 6)
returns table (id uuid, notion_page_id text, title text, url text, content text, similarity float)
language sql stable as $$
  select id, notion_page_id, title, url, content, 1 - (embedding <=> query_embedding) as similarity
  from notion_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;
