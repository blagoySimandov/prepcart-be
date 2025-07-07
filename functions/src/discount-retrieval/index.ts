import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { MatchedProduct, ShoppingListRequest, ShoppingListResponse } from "./types";
import { initializeAppIfNeeded } from "../util/firebase";
import { apiKeySecret, DEFAULT_DISCOUNT_LANGUAGE, FUNCTION_CONFIG } from "./constants";
import { isValidMethod, isValidRequestBody } from "./http";
import { translateShoppingListItems } from "./ai/translation";
import { searchProductsWithTypesense } from "../util/typesense-search";
import { filterBadCandidates } from "./ai/filter-bad-candidates";
import { calculateSavings } from "./ai/calculate-savings";

initializeAppIfNeeded();

export const matchShoppingList = onRequest(FUNCTION_CONFIG, async (request, response) => {
  const startTime = Date.now();
  const GEMINI_API_KEY = apiKeySecret.value();
  try {
    if (!isValidMethod(request, response)) {
      return;
    }
    if (!isValidRequestBody(request, response)) {
      return;
    }

    const requestData: ShoppingListRequest = request.body;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    logger.info("Processing shopping list", {
      itemCount: requestData.shopping_list.length,
      country: requestData.country,
      storeIds: requestData.store_ids,
    });

    // Step 1: Translate shopping list items
    const translationResults = await translateShoppingListItems(
      ai,
      requestData.shopping_list.map((i) => i.item),
      requestData.discount_language || DEFAULT_DISCOUNT_LANGUAGE
    );
    const { discountLanguage: discountLanguageTranslations, english: englishTranslations } =
      translationResults.result;

    logger.info("Translation results", {
      discountLanguageTranslations,
      englishTranslations,
    });

    // Step 2: Search for each shopping list item using both original and translated terms
    const shoppingListWithCandidates: MatchedProduct[] = [];

    for (let i = 0; i < requestData.shopping_list.length; i++) {
      const shoppingItem = requestData.shopping_list[i];
      const originalQuery = shoppingItem.item.trim();
      const discountLangQuery = discountLanguageTranslations[i];
      const englishQuery = englishTranslations[i];

      if (!originalQuery) {
        shoppingListWithCandidates.push({
          shopping_list_item: shoppingItem,
          matched_products: [],
        });
        continue;
      }

      logger.info("Searching for item with multiple languages", {
        original: originalQuery,
        discountLang: discountLangQuery,
        english: englishQuery,
      });
      const originalCandidates = await searchProductsWithTypesense({
        query: originalQuery,
        country: requestData.country,
        storeIds: requestData.store_ids,
        maxResults: 10,
      });

      const discountLangCandidates = discountLangQuery
        ? await searchProductsWithTypesense({
            query: discountLangQuery,
            country: requestData.country,
            storeIds: requestData.store_ids,
            maxResults: 10,
          })
        : [];

      const englishCandidates = englishQuery
        ? await searchProductsWithTypesense({
            query: englishQuery,
            country: requestData.country,
            storeIds: requestData.store_ids,
            maxResults: 10,
          })
        : [];

      const allCandidates = [
        ...originalCandidates,
        ...discountLangCandidates,
        ...englishCandidates,
      ];
      const uniqueCandidates = allCandidates.filter(
        (candidate, index, array) => array.findIndex((c) => c.id === candidate.id) === index
      );

      logger.info("Found candidates from all searches", {
        original: originalCandidates.length,
        discountLang: discountLangCandidates.length,
        english: englishCandidates.length,
        unique: uniqueCandidates.length,
      });

      shoppingListWithCandidates.push({
        shopping_list_item: shoppingItem,
        matched_products: uniqueCandidates,
      });
    }

    logger.info("Shopping list with candidates", {
      totalItems: shoppingListWithCandidates.length,
      totalCandidates: shoppingListWithCandidates.reduce(
        (sum, item) => sum + item.matched_products.length,
        0
      ),
    });

    const allMatches = await filterBadCandidates(ai, shoppingListWithCandidates);

    logger.info("Filtered matches", { allMatches });

    const savingsResult = await calculateSavings(allMatches, ai);

    logger.info("Savings calculation result", { savingsResult });

    const matchedShoppingItems = new Set(allMatches.map((m) => m.shopping_list_item.item));
    const allShoppingItems = requestData.shopping_list.map((i) => i.item.trim()).filter(Boolean);
    const unmatchedItems = allShoppingItems.filter((item) => !matchedShoppingItems.has(item));

    const endTime = Date.now();

    const responseData: ShoppingListResponse = {
      matches: allMatches,
      unmatched_items: unmatchedItems,
      total_potential_savings_by_currency: savingsResult.savings_by_currency,
      processing_time_ms: endTime - startTime,
    };

    logger.info("Final response data", { responseData });

    logger.info("Shopping list processing completed", {
      totalMatches: allMatches.length,
      unmatchedItems: unmatchedItems.length,
      totalSavings: responseData.total_potential_savings_by_currency,
      processingTimeMs: responseData.processing_time_ms,
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
});
