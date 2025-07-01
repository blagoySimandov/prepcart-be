import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { MatchedProduct, ShoppingListItem } from "../../types";
import {
  CHEAP_MODEL_NAME,
  DEFAULT_PREFFERED_CURRENCY,
  EMBEDDING_MODEL,
  MODEL_NAME,
} from "../../constants";
import { ProductCandidate } from "../../../util/types";

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

type CalculateSavingsReturn = Promise<{
  savings_by_currency: { [currency: string]: number };
}>;

const calculateSavings = async (
  matches: MatchedProduct[],
  prefferedCurrency: string,
  ai: GoogleGenAI,
): CalculateSavingsReturn => {
  if (matches.length === 0) {
    return { savings_by_currency: {} };
  }

  const matchesData = matches
    .map((match, index) => {
      const bestProduct = match.matched_products[0];
      if (!bestProduct) return null;

      return {
        id: index.toString(),
        shopping_item: match.shopping_list_item,
        product_name: bestProduct.product_name,
        product_quantity: bestProduct.quantity || "1 pcs",
      };
    })
    .filter(Boolean);

  logger.info("Requesting quantity multipliers from Gemini", {
    matchesData,
  });

  const prompt = `
Task: For each shopping list item, determine the quantity multiplier needed to calculate savings.

Shopping Items and Product Data:
${JSON.stringify(matchesData, null, 2)}

Instructions:
1.  The shopping_item contains the user's request with quantity information (e.g., {"item": "Cheese", "quantity": 500, "unit": "g"})
2.  The product_quantity describes what the discount price applies to (e.g., "1 bottle", "1 kg", "1 package")
3.  Determine the quantity_multiplier based on the user's requested quantity.
    *   Be very careful with weight conversions. For example, if the user wants 500g and the discount is for 1kg, the quantity_multiplier is 0.5.
    *   If the product_quantity is ambiguous (e.g., "per package", "1 piece") and the user requests a specific weight (e.g., 500g), you must estimate the weight of the package. Use your knowledge to make a reasonable guess (e.g., a standard package of sliced cheese might be 150g).
4.  Use your best judgment to interpret quantities and units in other cases where they don't match exactly.

Output Format (JSON):
{
  "quantity_calculations": [
    {
      "id": "The id of the item from the input",
      "quantity_multiplier": number
    }
  ]
}
`;

  const result = await ai.models.generateContent({
    model: CHEAP_MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseMimeType: "application/json" },
  });

  const responseText = result.text;
  if (!responseText) {
    logger.warn("Gemini returned no response for savings calculation");
    return { savings_by_currency: {} };
  }

  try {
    const geminiResponse = JSON.parse(responseText);
    logger.info("Gemini quantity calculation response", { geminiResponse });

    const quantityCalculations = new Map<
      string,
      { quantity_multiplier: number }
    >();
    if (geminiResponse.quantity_calculations) {
      for (const detail of geminiResponse.quantity_calculations) {
        quantityCalculations.set(detail.id, {
          quantity_multiplier: detail.quantity_multiplier,
        });
      }
    }

    const savingsByCurrency: { [currency: string]: number } = {};

    matches.forEach((match, index) => {
      const bestProduct = match.matched_products[0];
      if (!bestProduct) return;

      const calc = quantityCalculations.get(index.toString());
      if (!calc) {
        logger.warn("Could not find quantity calculation for item", {
          item: match.shopping_list_item.item,
        });
        return;
      }

      const baseSavings =
        (bestProduct.price_before_discount_local *
          bestProduct.discount_percent) /
        100;
      const totalSavings = baseSavings * calc.quantity_multiplier;
      const currency = bestProduct.currency_local;

      if (savingsByCurrency[currency]) {
        savingsByCurrency[currency] += totalSavings;
      } else {
        savingsByCurrency[currency] = totalSavings;
      }
    });

    // Round to 2 decimal places
    for (const currency in savingsByCurrency) {
      if (Object.prototype.hasOwnProperty.call(savingsByCurrency, currency)) {
        savingsByCurrency[currency] =
          Math.round(savingsByCurrency[currency] * 100) / 100;
      }
    }

    return {
      savings_by_currency: savingsByCurrency,
    };
  } catch (error) {
    logger.error("Failed to parse Gemini savings response", {
      error: error instanceof Error ? error.message : "Unknown error",
      response: responseText,
    });
    return { savings_by_currency: {} };
  }
};

export const calculateSavingsWithGemini = async (
  matches: MatchedProduct[],
  ai: GoogleGenAI,
): Promise<{
  savings_by_currency: { [currency: string]: number };
}> => {
  if (matches.length === 0) return { savings_by_currency: {} };
  const prefferedCurrency = DEFAULT_PREFFERED_CURRENCY;
  const result = await calculateSavings(matches, prefferedCurrency, ai);
  return result;
};

export const batchMatchWithGemini = async (
  itemsWithCandidates: {
    shoppingItem: ShoppingListItem;
    candidates: ProductCandidate[];
  }[],
  ai: GoogleGenAI,
): Promise<MatchedProduct[]> => {
  if (itemsWithCandidates.length === 0) {
    return [];
  }

  const candidatesMap = new Map<string, ProductCandidate>();
  const promptData = itemsWithCandidates.map(({ shoppingItem, candidates }) => {
    candidates.forEach((c) => candidatesMap.set(c.id, c));
    return {
      shopping_list_item: shoppingItem.item,
      shopping_item_quantity: shoppingItem.quantity,
      shopping_item_unit: shoppingItem.unit,
      candidates: candidates.map((c) => ({
        id: c.id,
        product_name: c.product_name,
        discount_percent: c.discount_percent,
        price_before_discount_local: c.price_before_discount_local,
        currency_local: c.currency_local,
        quantity: c.quantity,
        store_id: c.store_id,
        similarity_score: c.similarity_score.toFixed(3),
        requires_loyalty_card: c.requires_loyalty_card,
      })),
    };
  });

  const prompt = `
Task: For each shopping list item, find all matching discounted products from the provided candidates.

Here is the list of shopping items and their potential product matches:
${JSON.stringify(promptData, null, 2)}

Instructions:
1. For each shopping list item, evaluate its candidates to find all that match the item.
2. A match is valid ONLY if the product is a good fit for discounting the shopping list item. Consider all attributes.
3. The 'similarity_score' is a hint, but use your judgment.
4. Pay attention to shopping_item_quantity and shopping_item_unit when evaluating matches.
5. Consider the 'requires_loyalty_card' field - this indicates whether the discount requires a loyalty/membership card.
6. Only return a match if your confidence is 60 or higher (out of 100).
7. If no candidate is a good match, do not include it in your response.

Output Format (JSON Array):
[
  {
    "shopping_list_item": "The original shopping list item string",
    "matched_candidates": [
      {
        "id": "The id of a chosen candidate product",
        "confidence_score": number (0-100),
        "is_exact_match": boolean
      }
    ]
  }
]
`;

  const result = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseMimeType: "application/json" },
  });

  const responseText = result.text;
  if (!responseText) {
    logger.warn("Gemini returned no response for batch matching");
    return [];
  }

  try {
    type GeminiBatchResponseItem = {
      shopping_list_item: string;
      matched_candidates: {
        id: string;
        confidence_score: number;
        is_exact_match: boolean;
      }[];
    };

    const geminiResponse: GeminiBatchResponseItem[] = JSON.parse(responseText);

    const matches: MatchedProduct[] = [];
    for (const item of geminiResponse) {
      if (!item.matched_candidates || item.matched_candidates.length === 0) {
        continue;
      }

      const originalShoppingItem = itemsWithCandidates.find(
        (iwc) => iwc.shoppingItem.item === item.shopping_list_item,
      )?.shoppingItem;

      if (!originalShoppingItem) {
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
        matchedProducts.sort(
          (a, b) => (b.confidence_score || 0) - (a.confidence_score || 0),
        );

        matches.push({
          shopping_list_item: originalShoppingItem,
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
};
