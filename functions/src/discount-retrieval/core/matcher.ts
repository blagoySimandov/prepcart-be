import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import {
  ProductCandidate,
  ShoppingListItem,
  ShoppingListRequest,
} from "../types";
import {
  batchGenerateEmbeddings,
  batchMatchWithGemini,
  calculateSavingsWithGemini,
} from "../services/gemini";
import { searchSimilarProducts } from "../services/database";
import { translateShoppingList } from "../services/translation";
import { DEFAULT_DISCOUNT_LANGUAGE } from "../constants";

export const findMatchingProducts = async (
  requestData: ShoppingListRequest,
  ai: GoogleGenAI
) => {
  const maxResultsPerItem = requestData.max_results_per_item || 10;

  logger.info("Processing shopping list", {
    itemCount: requestData.shopping_list.length,
    country: requestData.country,
    storeIds: requestData.store_ids,
  });

  const discountLanguage =
    requestData.discount_language || DEFAULT_DISCOUNT_LANGUAGE;

  const translationMap = await translateShoppingList(
    requestData.shopping_list,
    discountLanguage,
    ai
  );

  const allTranslatedItems = [...new Set(Array.from(translationMap.values()))];
  const embeddingMap = await batchGenerateEmbeddings(allTranslatedItems, ai);

  const itemsWithCandidates: {
    shoppingItem: ShoppingListItem;
    candidates: ProductCandidate[];
  }[] = [];

  for (const shoppingItem of requestData.shopping_list) {
    const itemText = shoppingItem.item.trim();
    if (!itemText) continue;

    const translatedItemText = translationMap.get(itemText) || itemText;
    const embedding = embeddingMap.get(translatedItemText);

    if (!embedding) {
      logger.warn("Could not find embedding for item.", {
        item: itemText,
        translatedItem: translatedItemText,
      });
      continue;
    }

    try {
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
        itemsWithCandidates.push({ shoppingItem, candidates });
      }
    } catch (error) {
      logger.error("Error processing shopping item", {
        item: itemText,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const allMatches = await batchMatchWithGemini(itemsWithCandidates, ai);

  const savingsResult = await calculateSavingsWithGemini(allMatches, ai);

  return { allMatches, savingsResult };
};
