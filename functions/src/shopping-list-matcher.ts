import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import {
  ShoppingListRequest,
  ShoppingListResponse,
  ProductCandidate,
  MatchedProduct,
} from "./types";
import { initializeAppIfNeeded } from "./firebase";

initializeAppIfNeeded();

const API_KEY_SECRET = defineSecret("API_KEY");
const db = getFirestore();

const EMBEDDING_MODEL = "text-embedding-004";
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const PRODUCTS_COLLECTION = "products";

// Helper function to generate embeddings for shopping list items
const generateEmbedding = async (
  text: string,
  ai: GoogleGenAI,
): Promise<number[]> => {
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ parts: [{ text }] }],
    config: { taskType: "RETRIEVAL_QUERY" },
  });

  const embedding = result.embeddings?.[0]?.values;
  if (!embedding || embedding.length === 0) {
    throw new Error(`Failed to generate embedding for: ${text}`);
  }
  return embedding;
};

// Helper function to search for similar products using Firestore native vector search
const searchSimilarProducts = async (
  queryEmbedding: number[],
  country?: string,
  storeIds?: string[],
  maxResults = 10,
): Promise<ProductCandidate[]> => {
  const collection = db.collection(PRODUCTS_COLLECTION);

  // Apply filters before vector search
  let query = collection
    .where("archivedAt", "==", null)
    .where("isEmbedded", "==", true);

  if (country) {
    query = query.where("country", "==", country);
  }

  if (storeIds && storeIds.length > 0) {
    query = query.where("storeId", "in", storeIds);
  }

  try {
    // Use Firestore's native vector search
    const vectorQuery = query.findNearest({
      vectorField: "embedding",
      queryVector: queryEmbedding,
      limit: maxResults,
      distanceMeasure: "COSINE",
      distanceResultField: "similarity_score",
    });

    const snapshot = await vectorQuery.get();

    const candidates: ProductCandidate[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const product = data;

      candidates.push({
        id: product.id,
        product_name: product.discount.product_name,
        store_id: product.storeId,
        country: product.country,
        discount_percent: product.discount.discount_percent,
        price_before_discount_local:
          product.discount.price_before_discount_local,
        currency_local: product.discount.currency_local,
        page_number: product.discount.page_number,
        similarity_score: data.similarity_score || 0,
      });
    });

    return candidates;
  } catch (error) {
    logger.warn("Vector search failed, falling back to regular query", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
};

const matchWithGemini = async (
  shoppingItem: string,
  candidates: ProductCandidate[],
  ai: GoogleGenAI,
): Promise<MatchedProduct[]> => {
  if (candidates.length === 0) return [];

  const candidatesText = candidates
    .map(
      (c, i) =>
        `${i + 1}. "${c.product_name}" (${c.discount_percent}% off, ${
          c.price_before_discount_local
        } ${c.currency_local}, Store: ${
          c.store_id
        }, Similarity: ${c.similarity_score.toFixed(3)})`,
    )
    .join("\n");

  const prompt = `
Task: Match a shopping list item with the most relevant discounted products.

Shopping List Item: "${shoppingItem}"

Available Discounted Products:
${candidatesText}

Instructions:
1. Identify which products (if any) match the shopping list item
2. Consider product names, brands, categories, and variations
3. Account for different languages, abbreviations, and synonyms
4. Rate confidence from 0-100 (100 = perfect match, 0 = no match)
5. Only include matches with confidence >= 60
6. Provide reasoning for each match

Output Format (JSON):
{
  "matches": [
    {
      "product_index": number,
      "confidence_score": number,
      "match_reasoning": "string explaining why this matches",
      "is_exact_match": boolean
    }
  ]
}

Return empty matches array if no good matches found.
`;

  const result = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseMimeType: "application/json" },
  });

  const responseText = result.text;
  if (!responseText) {
    logger.warn("Gemini returned no response for matching", { shoppingItem });
    return [];
  }

  try {
    const geminiResponse = JSON.parse(responseText);
    const matches: MatchedProduct[] = [];

    for (const match of geminiResponse.matches || []) {
      const candidateIndex = match.product_index - 1; // Convert to 0-based
      if (candidateIndex >= 0 && candidateIndex < candidates.length) {
        matches.push({
          shopping_list_item: shoppingItem,
          matched_product: candidates[candidateIndex],
          confidence_score: match.confidence_score,
          match_reasoning: match.match_reasoning,
          is_exact_match: match.is_exact_match,
        });
      }
    }

    return matches.sort((a, b) => b.confidence_score - a.confidence_score);
  } catch (error) {
    logger.error("Failed to parse Gemini matching response", {
      shoppingItem,
      error: error instanceof Error ? error.message : "Unknown error",
      response: responseText,
    });
    return [];
  }
};

export const matchShoppingList = onRequest(
  {
    memory: "1GiB",
    timeoutSeconds: 300,
    secrets: [API_KEY_SECRET],
    region: "europe-west1",
    cors: true,
  },
  async (request, response) => {
    const startTime = Date.now();

    try {
      // Validate request
      if (request.method !== "POST") {
        response.status(405).json({ error: "Method not allowed" });
        return;
      }

      const requestData: ShoppingListRequest = request.body;
      if (
        !requestData.shopping_list ||
        !Array.isArray(requestData.shopping_list) ||
        requestData.shopping_list.length === 0
      ) {
        response.status(400).json({
          error: "shopping_list is required and must be a non-empty array",
        });
        return;
      }

      const apiKey = API_KEY_SECRET.value();
      if (!apiKey) {
        response.status(500).json({ error: "API key not configured" });
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const maxResultsPerItem = requestData.max_results_per_item || 10;

      logger.info("Processing shopping list", {
        itemCount: requestData.shopping_list.length,
        country: requestData.country,
        storeIds: requestData.store_ids,
      });

      const allMatches: MatchedProduct[] = [];
      const unmatchedItems: string[] = [];

      // Process each shopping list item
      for (const shoppingItem of requestData.shopping_list) {
        const itemText = shoppingItem.item.trim();
        if (!itemText) continue;

        try {
          // Generate embedding for the shopping list item
          const embedding = await generateEmbedding(itemText, ai);

          // Search for similar products using Firestore native vector search
          const candidates = await searchSimilarProducts(
            embedding,
            requestData.country,
            requestData.store_ids,
            maxResultsPerItem,
          );

          logger.info("Found candidates", {
            item: itemText,
            candidates: candidates.length,
          });

          if (candidates.length === 0) {
            unmatchedItems.push(itemText);
            continue;
          }

          // Use Gemini to intelligently match
          const matches = await matchWithGemini(itemText, candidates, ai);

          if (matches.length === 0) {
            unmatchedItems.push(itemText);
          } else {
            allMatches.push(...matches);
          }
        } catch (error) {
          logger.error("Error processing shopping item", {
            item: itemText,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          unmatchedItems.push(itemText);
        }
      }

      // Calculate total potential savings (grouped by currency)
      const savingsByCurrency: { [currency: string]: number } = {};

      allMatches.forEach((match) => {
        const originalPrice = match.matched_product.price_before_discount_local;
        const discountPercent = match.matched_product.discount_percent;
        const currency = match.matched_product.currency_local;
        const savings = (originalPrice * discountPercent) / 100;

        if (!savingsByCurrency[currency]) {
          savingsByCurrency[currency] = 0;
        }
        savingsByCurrency[currency] += savings;
      });

      // Round savings to 2 decimal places
      Object.keys(savingsByCurrency).forEach((currency) => {
        savingsByCurrency[currency] =
          Math.round(savingsByCurrency[currency] * 100) / 100;
      });

      const processingTimeMs = Date.now() - startTime;

      const responseData: ShoppingListResponse = {
        matches: allMatches,
        unmatched_items: unmatchedItems,
        total_potential_savings_by_currency: savingsByCurrency,
        processing_time_ms: processingTimeMs,
      };

      logger.info("Shopping list processing completed", {
        totalMatches: allMatches.length,
        unmatchedItems: unmatchedItems.length,
        totalSavings: responseData.total_potential_savings_by_currency,
        processingTimeMs,
      });

      response.json(responseData);
    } catch (error) {
      logger.error("Error in shopping list matching", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      response.status(500).json({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);
