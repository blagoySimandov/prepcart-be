/* eslint-disable operator-linebreak */
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { Product } from "./types";
import { initializeAppIfNeeded } from "./firebase";

initializeAppIfNeeded();

const API_KEY_SECRET = defineSecret("API_KEY");
const db = getFirestore();

const EMBEDDING_MODEL = "text-embedding-004";
const PRODUCTS_COLLECTION = "products";

export const onProductEmbed = onTaskDispatched<Product>(
  {
    secrets: [API_KEY_SECRET],
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
      const apiKey = API_KEY_SECRET.value();
      if (!apiKey) throw new Error("API_KEY secret not configured.");

      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [{ parts: [{ text: productName }] }],
        config: { taskType: "RETRIEVAL_DOCUMENT" },
      });
      const embedding = result.embeddings?.[0]?.values;

      if (!embedding || embedding.length === 0) {
        throw new Error("API response did not contain an embedding.");
      }

      // Store embedding as a proper Firestore vector for vector search
      await db
        .collection(PRODUCTS_COLLECTION)
        .doc(id)
        .update({
          embedding: FieldValue.vector(embedding),
          isEmbedded: true,
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
  }
);
