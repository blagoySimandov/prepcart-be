import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import {
  ProductCandidate,
  ShoppingListRequest,
  ShoppingListResponse,
} from "./types";
import { initializeAppIfNeeded } from "../util/firebase";
import { searchSimilarProducts } from "./database";
import {
  generateEmbedding,
  calculateSavingsWithGemini,
  batchMatchWithGemini,
} from "./gemini";

initializeAppIfNeeded();

const API_KEY_SECRET = defineSecret("API_KEY");

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

      const itemsWithCandidates: {
        item: string;
        candidates: ProductCandidate[];
      }[] = [];

      for (const shoppingItem of requestData.shopping_list) {
        const itemText = shoppingItem.item.trim();
        if (!itemText) continue;

        try {
          const embedding = await generateEmbedding(itemText, ai);

          const candidates = await searchSimilarProducts(
            embedding,
            requestData.country,
            requestData.store_ids,
            maxResultsPerItem
          );

          logger.info("Found candidates", {
            item: itemText,
            candidates: candidates.length,
          });

          if (candidates.length > 0) {
            itemsWithCandidates.push({ item: itemText, candidates });
          }
        } catch (error) {
          logger.error("Error processing shopping item", {
            item: itemText,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      const allMatches = await batchMatchWithGemini(itemsWithCandidates, ai);

      const matchedShoppingItems = new Set(
        allMatches.map((m) => m.shopping_list_item)
      );
      const allShoppingItems = requestData.shopping_list
        .map((i) => i.item.trim())
        .filter(Boolean);
      const unmatchedItems = allShoppingItems.filter(
        (item) => !matchedShoppingItems.has(item)
      );

      const savingsByCurrency = await calculateSavingsWithGemini(
        allMatches,
        ai
      );

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
  }
);
