-- Enable the pgvector extension
create extension if not exists vector;

-- Create the documents table
create table documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb,
  embedding vector(384)  -- 384 for nomic-embed, 1536 for OpenAI
);

-- Create an index for fast similarity search
create index on documents 
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);


