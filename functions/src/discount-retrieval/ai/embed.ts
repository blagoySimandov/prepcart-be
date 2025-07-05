import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { EMBEDDING_MODEL } from "../constants";

export const batchGenerateEmbeddings = async (
  texts: string[],
  ai: GoogleGenAI,
): Promise<Map<string, number[]>> => {
  if (texts.length === 0) {
    return new Map();
  }

  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts.map((text) => ({ parts: [{ text }] })),
    config: { taskType: "RETRIEVAL_QUERY" },
  });

  const embeddings = result.embeddings;
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error("Mismatch in batch embedding response count.");
  }

  const embeddingMap = new Map<string, number[]>();
  embeddings.forEach((contentEmbedding, i) => {
    const text = texts[i];
    const embedding = contentEmbedding.values;
    if (embedding && embedding.length > 0) {
      embeddingMap.set(text, embedding);
    } else {
      logger.warn(`Failed to generate embedding for: ${text}`);
    }
  });

  return embeddingMap;
};
