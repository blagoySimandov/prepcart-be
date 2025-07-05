import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { MatchedProduct, ShoppingListRequest, ShoppingListResponse } from "./types";
import { initializeAppIfNeeded } from "../util/firebase";
import { DEFAULT_DISCOUNT_LANGUAGE, FUNCTION_CONFIG, GEMINI_API_KEY } from "./constants";
import { isValidMethod, isValidRequestBody } from "./http";
import { translateShoppingListItems } from "./ai/translation";
import { batchGenerateEmbeddings } from "./ai/embed";
import { extractCandidateArrays } from "./util";
import { filterBadCandidates } from "./ai/filter-bad-candidates";
import { calculateSavings } from "./ai/calculate-savings";

initializeAppIfNeeded();

export const matchShoppingList = onRequest(FUNCTION_CONFIG, async (request, response) => {
  const startTime = Date.now();
  try {
    if (!isValidMethod(request, response)) {
      return;
    }
    if (!isValidRequestBody(request, response)) {
      return;
    }

    const requestData: ShoppingListRequest = request.body;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const translationResults = await translateShoppingListItems(
      ai,
      requestData.shopping_list.map((i) => i.item),
      requestData.discount_language || DEFAULT_DISCOUNT_LANGUAGE,
    );
    const { discountLanguage: discountLanguageTranslations, english: englishTranslations } =
      translationResults.result;

    const embeddingsDiscountLang = await batchGenerateEmbeddings(discountLanguageTranslations, ai);
    const embeddingsEnglish = await batchGenerateEmbeddings(englishTranslations, ai);
    const { englishCandidates, discountLanguageCandidates } = await extractCandidateArrays(
      embeddingsDiscountLang,
      embeddingsEnglish,
      requestData?.country,
      requestData?.store_ids,
    );

    const shoppingListWithCandidates: MatchedProduct[] = requestData.shopping_list.map(
      (item, i) => {
        return {
          shopping_list_item: item,
          matched_products: [...discountLanguageCandidates[i], ...englishCandidates[i]],
        };
      },
    );

    const allMatches = await filterBadCandidates(ai, shoppingListWithCandidates);

    const savingsResult = await calculateSavings(allMatches, ai);

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
