import { GoogleGenAI } from "@google/genai";
import { MatchedProduct, ProductCandidate } from "../types";
import { CHEAP_MODEL_NAME } from "../constants";
import { PROMPTS } from "./prompts";
import { logger } from "firebase-functions/v2";
import { GeminiBatchResponseItem } from "./types";

export async function filterBadCandidates(
  ai: GoogleGenAI,
  shoppingListWithCandidates: MatchedProduct[]
): Promise<MatchedProduct[]> {
  if (shoppingListWithCandidates.length === 0) {
    return [];
  }

  const candidatesMap = new Map<string, ProductCandidate>();
  shoppingListWithCandidates.forEach(({ matched_products: matchedProducts }) => {
    matchedProducts.forEach((c) => candidatesMap.set(c.id, c));
  });

  const prompt = PROMPTS.filterCandidatesPrompt({
    shoppingListWithCandidates,
  });

  const response = await ai.models.generateContent({
    model: CHEAP_MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const responseText = response.text;
  if (!responseText) {
    logger.warn("Gemini returned no response for batch matching");
    return [];
  }

  try {
    const geminiResponse: GeminiBatchResponseItem[] = JSON.parse(responseText);

    const matches: MatchedProduct[] = [];
    for (const item of geminiResponse) {
      if (!item.matched_candidates || item.matched_candidates.length === 0) {
        continue;
      }

      const originalShoppingItemContainer = shoppingListWithCandidates.find(
        (slwc) => slwc.shopping_list_item.item === item.shopping_list_item
      );

      if (!originalShoppingItemContainer) {
        logger.warn("Could not find original shopping item", {
          searchedItem: item.shopping_list_item,
        });
        continue;
      }

      const matchedProducts: ProductCandidate[] = [];
      for (const geminiCandidate of item.matched_candidates) {
        const product = candidatesMap.get(geminiCandidate.id);
        if (product) {
          matchedProducts.push({
            ...product,
            confidence_score: geminiCandidate.confidence_score,
            is_exact_match: geminiCandidate.is_exact_match,
          });
        }
      }

      if (matchedProducts.length > 0) {
        matchedProducts.sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0));

        matches.push({
          shopping_list_item: originalShoppingItemContainer.shopping_list_item,
          matched_products: matchedProducts,
        });
      }
    }
    return matches;
  } catch (error) {
    logger.error("Failed to parse Gemini batch matching response", {
      error: error instanceof Error ? error.message : "Unknown error",
      response: responseText,
    });
    return [];
  }
}
