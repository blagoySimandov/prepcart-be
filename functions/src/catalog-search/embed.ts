import { GoogleGenAI } from "@google/genai";
import { EMBEDDING_MODEL } from "./constants";

export async function embedQuery(ai: GoogleGenAI, text: string) {
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ parts: [{ text }] }],
    config: { taskType: "RETRIEVAL_DOCUMENT" },
  });
  const embedding = result?.embeddings?.[0]?.values;

  if (!embedding) {
    throw new Error("API response did not contain an embedding.");
  }

  return embedding;
}
