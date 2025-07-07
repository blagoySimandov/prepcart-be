import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { initializeAppIfNeeded } from "../util/firebase";
import { Product } from "./types";
import { API_KEY_SECRET, EMBEDDING_MODEL, PRODUCTS_COLLECTION } from "../constants";

initializeAppIfNeeded();

const API_KEY = defineSecret(API_KEY_SECRET);
const db = getFirestore();

export const onProductEmbed = onTaskDispatched<Product>(
  {
    secrets: [API_KEY],
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 6, maxDispatchesPerSecond: 2 },
  },
  async (req) => {
    const product = req.data;
    const { id, discount } = product;
    const productName = discount.product_name;

    if (!productName) {
      logger.warn("Product has no name, cannot process.", { productId: id });
      return;
    }

    try {
      const apiKey = API_KEY.value();
      if (!apiKey) throw new Error("API_KEY secret not configured.");

      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [{ parts: [{ text: productName }] }],
        config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 1536 },
      });
      const embedding = result.embeddings?.[0]?.values;

      if (!embedding || embedding.length === 0) {
        throw new Error("API response did not contain an embedding.");
      }

      await db
        .collection(PRODUCTS_COLLECTION)
        .doc(id)
        .update({
          embedding: FieldValue.vector(embedding),
          isEmbedded: true,
          lastEmbeddingUpdate: FieldValue.serverTimestamp(),
        });

      logger.info("Successfully processed embedding for product:", {
        productId: id,
        productName,
        embeddingDimensions: embedding.length,
      });
    } catch (error) {
      logger.error("Error processing embedding task:", {
        productId: id,
        productName,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  },
);
