import { createClient } from "@supabase/supabase-js";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
dotenv.config({
  path: path.resolve(__dirname, "..", "..", ".env.local"),
  override: false,
});

// ── Supabase client ───────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !roleKey) {
  throw new Error(
    "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) " +
      "and SUPABASE_SERVICE_ROLE_KEY in the repo root .env file."
  );
}

const supabase = createClient(supabaseUrl, roleKey);

// ── Embedding model — pick ONE option below ───────────────────────────────────
//
// OPTION A: HuggingFace (FREE)
//   Model: BAAI/bge-small-en-v1.5  → 384-dim, works on free HF Inference API
//   Make sure HUGGINGFACE_API_KEY is set in .env
//   ⚠️  If you use this, your Supabase `documents` table embedding column must be vector(384)
//
// OPTION B: OpenAI (RECOMMENDED — more reliable, better quality)
//   Model: text-embedding-3-small  → 1536-dim
//   Make sure OPENAI_API_KEY is set in .env
//   ⚠️  If you use this, your Supabase `documents` table embedding column must be vector(1536)
//
// ─────────────────────────────────────────────────────────────────────────────

const USE_OPENAI = !!process.env.OPENAI_API_KEY; // auto-picks OpenAI if key exists, else HF

const embeddings = USE_OPENAI
  ? new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY!,
      model: "text-embedding-3-small", // 1536-dim
    })
  : new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACE_API_KEY!,
      model: "BAAI/bge-small-en-v1.5", // 384-dim — free tier works fine
    });

console.log(`Using embeddings: ${USE_OPENAI ? "OpenAI text-embedding-3-small (1536-dim)" : "HuggingFace BAAI/bge-small-en-v1.5 (384-dim)"}`);

// ── Sources ───────────────────────────────────────────────────────────────────
const PAGES = [
  "https://classsly.in/",
  // add more URLs here if you have feature/pricing pages
];

const LOCAL_DOCS = [
  {
    filePath: path.join(__dirname, "classsly_rag_knowledge_base.md"),
    source: "local/classsly_rag_knowledge_base.md",
    title: "Classsly Product Knowledge Base",
  },
];

// ── Scraper ───────────────────────────────────────────────────────────────────
async function scrapeUrl(pageUrl: string): Promise<{ text: string; title: string }> {
  const { data } = await axios.get(pageUrl);
  const $ = cheerio.load(data);

  $("nav, footer, script, style, .wp-block-navigation").remove();
  const title = $("title").text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();

  return { text, title };
}

// ── Batch helper (avoids rate-limit timeouts on large docs) ──────────────────
async function embedInBatches(texts: string[], batchSize = 20): Promise<number[][]> {
  const allVectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await embeddings.embedDocuments(batch);
    allVectors.push(...vectors);
    console.log(`    embedded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);
  }
  return allVectors;
}

// ── Main ingestion ────────────────────────────────────────────────────────────
async function ingest() {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  // 1. Scrape URLs
  for (const pageUrl of PAGES) {
    console.log(`\nScraping: ${pageUrl}`);
    const { text, title } = await scrapeUrl(pageUrl);
    const chunks = await splitter.createDocuments([text], [{ source: pageUrl, title }]);
    console.log(`  → ${chunks.length} chunks`);

    const vectors = await embedInBatches(chunks.map((c) => c.pageContent));
    const rows = chunks.map((chunk, i) => ({
      content: chunk.pageContent,
      metadata: chunk.metadata,
      embedding: vectors[i],
    }));

    const { error } = await supabase.from("documents").insert(rows);
    if (error) throw error;
    console.log(`  ✓ Inserted ${rows.length} rows`);
  }

  // 2. Ingest local markdown files
  for (const doc of LOCAL_DOCS) {
    if (!fs.existsSync(doc.filePath)) {
      console.warn(`\n⚠️  File not found, skipping: ${doc.filePath}`);
      continue;
    }

    console.log(`\nReading local file: ${doc.filePath}`);
    const text = fs.readFileSync(doc.filePath, "utf-8");
    const chunks = await splitter.createDocuments(
      [text],
      [{ source: doc.source, title: doc.title }]
    );
    console.log(`  → ${chunks.length} chunks`);

    const vectors = await embedInBatches(chunks.map((c) => c.pageContent));
    const rows = chunks.map((chunk, i) => ({
      content: chunk.pageContent,
      metadata: chunk.metadata,
      embedding: vectors[i],
    }));

    const { error } = await supabase.from("documents").insert(rows);
    if (error) throw error;
    console.log(`  ✓ Inserted ${rows.length} rows`);
  }

  console.log("\n✅ Ingestion complete!");
}

ingest().catch((err) => {
  console.error("❌ Ingestion failed:", err);
  process.exit(1);
});