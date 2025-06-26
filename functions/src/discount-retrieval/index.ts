import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { ShoppingListRequest, ShoppingListResponse } from "./types";
import { initializeAppIfNeeded } from "../util/firebase";
import { API_KEY_SECRET } from "./constants";
import { findMatchingProducts } from "./core";

initializeAppIfNeeded();

const apiKeySecret = defineSecret(API_KEY_SECRET);

export const matchShoppingList = onRequest(
  {
    memory: "1GiB",
    timeoutSeconds: 300,
    secrets: [apiKeySecret],
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

      const apiKey = apiKeySecret.value();
      if (!apiKey) {
        response.status(500).json({ error: "API key not configured" });
        return;
      }

      const ai = new GoogleGenAI({ apiKey });

      const { allMatches, savingsResult } = await findMatchingProducts(
        requestData,
        ai
      );

      const matchedShoppingItems = new Set(
        allMatches.map((m) => m.shopping_list_item.item)
      );
      const allShoppingItems = requestData.shopping_list
        .map((i) => i.item.trim())
        .filter(Boolean);
      const unmatchedItems = allShoppingItems.filter(
        (item) => !matchedShoppingItems.has(item)
      );

      const processingTimeMs = Date.now() - startTime;

      const responseData: ShoppingListResponse = {
        matches: allMatches,
        unmatched_items: unmatchedItems,
        total_potential_savings_by_currency: savingsResult.savings_by_currency,
        processing_time_ms: processingTimeMs,
        savings_explanation: savingsResult.explanation,
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
