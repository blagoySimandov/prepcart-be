import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import {
  MatchedProduct,
  ProductCandidate,
  ShoppingListItem,
} from "../../types";
import {
  CHEAP_MODEL_NAME,
  DEFAULT_PREFFERED_CURRENCY,
  EMBEDDING_MODEL,
  MODEL_NAME,
} from "../../constants";

export const batchGenerateEmbeddings = async (
  texts: string[],
  ai: GoogleGenAI
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
  explanation: string;
}>;

const calculateSavings = async (
  matches: MatchedProduct[],
  prefferedCurrency: string,
  ai: GoogleGenAI
): CalculateSavingsReturn => {
  if (matches.length === 0) {
    return { savings_by_currency: {}, explanation: "" };
  }

  const matchesData = matches
    .map((match) => {
      const bestProduct = match.matched_products[0];
      if (!bestProduct) return null;

      return {
        shopping_item: match.shopping_list_item,
        product_name: bestProduct.product_name,
        price_before_discount: bestProduct.price_before_discount_local,
        currency: bestProduct.currency_local,
        discount_percent: bestProduct.discount_percent,
        product_quantity: bestProduct.quantity || "1 pcs",
        confidence_score: bestProduct.confidence_score,
      };
    })
    .filter(Boolean);

  logger.info("Calculating total potential savings", {
    matchesData,
  });

  const prompt = `
Task: Calculate total potential savings from matched shopping list items, taking into account the requested quantity from the shopping list.

Matched Products Data:
${JSON.stringify(matchesData, null, 2)}

Instructions:
1. For each match, calculate base savings = (price_before_discount * discount_percent / 100). This is the savings for a single unit of the product.
2. The shopping_item contains the user's request with quantity information (e.g., {"item": "Wine", "quantity": 2, "unit": undefined})
3. The product_quantity describes what the discount price applies to (e.g., "1 bottle", "500g", "1 pcs")
4. Determine the quantity_multiplier based on the user's requested quantity. For example, if the user wants 2 bottles of wine and the discount is for 1 bottle, the multiplier is 2. The multiplier can also be less than one. For example, if the discount is for 1kg and the user wants 500g, the quantity_multiplier should be 0.5.
5. Use your best judgment to interpret quantities and units when they don't match exactly.
6. Return the base_savings and quantity_multiplier for each item. Do not calculate the final total savings.

Output Format (JSON):
{
  "calculation_details": [
    {
      "shopping_item": "string representation of the item",
      "product_name": "string",
      "base_savings": number,
      "quantity_multiplier": number,
      "currency": "string"
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
    return { savings_by_currency: {}, explanation: "" };
  }

  try {
    const geminiResponse = JSON.parse(responseText);
    logger.info("Gemini savings calculation response", { geminiResponse });

    const savingsByCurrency: { [currency: string]: number } = {};
    if (geminiResponse.calculation_details) {
      for (const detail of geminiResponse.calculation_details) {
        const totalSavings = detail.base_savings * detail.quantity_multiplier;
        if (savingsByCurrency[detail.currency]) {
          savingsByCurrency[detail.currency] += totalSavings;
        } else {
          savingsByCurrency[detail.currency] = totalSavings;
        }
      }
    }

    // Round to 2 decimal places
    for (const currency in savingsByCurrency) {
      if (Object.prototype.hasOwnProperty.call(savingsByCurrency, currency)) {
        savingsByCurrency[currency] =
          Math.round(savingsByCurrency[currency] * 100) / 100;
      }
    }

    return {
      savings_by_currency: savingsByCurrency,
      explanation: "Total Savings = Sum(Base Product Savings * Quantity)",
    };
  } catch (error) {
    logger.error("Failed to parse Gemini savings response", {
      error: error instanceof Error ? error.message : "Unknown error",
      response: responseText,
    });
    return { savings_by_currency: {}, explanation: "" };
  }
};

export const calculateSavingsWithGemini = async (
  matches: MatchedProduct[],
  ai: GoogleGenAI
): Promise<{
  savings_by_currency: { [currency: string]: number };
  explanation: string;
}> => {
  if (matches.length === 0) return { savings_by_currency: {}, explanation: "" };
  const prefferedCurrency = DEFAULT_PREFFERED_CURRENCY;
  const result = await calculateSavings(matches, prefferedCurrency, ai);
  return result;
};

export const batchMatchWithGemini = async (
  itemsWithCandidates: {
    shoppingItem: ShoppingListItem;
    candidates: ProductCandidate[];
  }[],
  ai: GoogleGenAI
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
5. Only return a match if your confidence is 60 or higher (out of 100).
6. If no candidate is a good match, do not include it in your response.

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
        (iwc) => iwc.shoppingItem.item === item.shopping_list_item
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
          (a, b) => (b.confidence_score || 0) - (a.confidence_score || 0)
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
