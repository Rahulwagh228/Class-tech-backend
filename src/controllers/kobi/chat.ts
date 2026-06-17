import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import Groq from "groq-sdk";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const embeddings = new HuggingFaceInferenceEmbeddings({
  apiKey: process.env.HUGGINGFACE_API_KEY!,
  model: "sentence-transformers/all-MiniLM-L6-v2", // ✅ matches what you used for ingestion
});
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export async function chatHandler(req: Request, res: Response) {
  try {
    const { message } = req.body;

    // 1. Embed the user's question
    const queryEmbedding = await embeddings.embedQuery(message);

    // 2. Similarity search in pgvector
    const { data: docs, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.05,
      match_count: 5,
    });

    console.log(docs, "docssssssssssssss")

    if (error) return res.status(500).json({ error: error.message });

    // 3. Build context from retrieved chunks
    const context = docs
      .map((d: any) => `[Source: ${d.metadata?.source}]\n${d.content}`)
      .join("\n\n---\n\n");

    // 4. Call Groq LLM with context
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant for Classly, a fee management and school operations platform built in India. 
Answer questions based ONLY on the context below. If the answer isn't in the context, say you don't have that information and suggest the user contact the Classly team.
Be concise, friendly, and professional.

Context:
${context}`,
        },
        { role: "user", content: message },
      ],
    });

    const answer = completion.choices[0].message.content;
    console.log(answer, "answer")
    return res.status(200).json({ answer });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}