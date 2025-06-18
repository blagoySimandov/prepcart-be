import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import {
  MatchedProduct,
  ProductCandidate,
  SavingsCalculationDetail,
} from "./types";
import { calculateSavingsLocally } from "./savings";

const EMBEDDING_MODEL = "text-embedding-004";
const MODEL_NAME = "gemini-2.5-flash-lite-preview-06-17";
const CHEAP_MODEL_NAME = "gemini-2.0-flash-lite";

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

const calculateAmbiguousSavingsWithGemini = async (
  ambiguousMatches: MatchedProduct[],
  ai: GoogleGenAI,
): Promise<{
  savings_by_currency: { [currency: string]: number };
  calculation_details: SavingsCalculationDetail[];
}> => {
  if (ambiguousMatches.length === 0) {
    return { savings_by_currency: {}, calculation_details: [] };
  }

  const matchesData = ambiguousMatches.map((match) => ({
    shopping_item: match.shopping_list_item,
    product_name: match.matched_product.product_name,
    price_before_discount: match.matched_product.price_before_discount_local,
    currency: match.matched_product.currency_local,
    discount_percent: match.matched_product.discount_percent,
    quantity: match.matched_product.quantity || "1 pcs",
    confidence_score: match.confidence_score,
  }));

  const prompt = `
Task: Calculate total potential savings from matched shopping list items with AMBIGUOUS quantities only.

Matched Products with Ambiguous Quantities:
${JSON.stringify(matchesData, null, 2)}

Instructions:
1. For each match, calculate savings = (price_before_discount * discount_percent / 100)
2. These products have ambiguous quantity descriptions (family size, large, etc.)
3. Use your best judgment to interpret quantity and adjust savings accordingly
4. Group total savings by currency
5. Round to 2 decimal places

Output Format (JSON):
{
  "savings_by_currency": {
    "EUR": number,
    "BGN": number,
    "USD": number
  },
  "calculation_details": [
    {
      "shopping_item": "string",
      "product_name": "string",
      "savings": number,
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
    logger.warn(
      "Gemini returned no response for ambiguous savings calculation",
    );
    return { savings_by_currency: {}, calculation_details: [] };
  }

  try {
    const geminiResponse = JSON.parse(responseText);
    const details = (geminiResponse.calculation_details || []).map(
      (detail: any) => ({
        ...detail,
        used_local_calculation: false,
      }),
    );

    logger.info("Gemini ambiguous savings calculation details", { details });

    return {
      savings_by_currency: geminiResponse.savings_by_currency || {},
      calculation_details: details,
    };
  } catch (error) {
    logger.error("Failed to parse Gemini ambiguous savings response", {
      error: error instanceof Error ? error.message : "Unknown error",
      response: responseText,
    });
    return { savings_by_currency: {}, calculation_details: [] };
  }
};

export const calculateSavingsWithGemini = async (
  matches: MatchedProduct[],
  ai: GoogleGenAI,
): Promise<{ [currency: string]: number }> => {
  if (matches.length === 0) return {};

  const localResult = calculateSavingsLocally(matches);

  const geminiResult = await calculateAmbiguousSavingsWithGemini(
    localResult.ambiguous_matches,
    ai,
  );

  const finalSavingsByCurrency = { ...localResult.savings_by_currency };

  Object.entries(geminiResult.savings_by_currency).forEach(
    ([currency, savings]) => {
      if (!finalSavingsByCurrency[currency]) {
        finalSavingsByCurrency[currency] = 0;
      }
      finalSavingsByCurrency[currency] += savings;
      finalSavingsByCurrency[currency] =
        Math.round(finalSavingsByCurrency[currency] * 100) / 100;
    },
  );

  const allDetails = [
    ...localResult.calculation_details,
    ...geminiResult.calculation_details,
  ];
  const localCount = localResult.calculation_details.length;
  const geminiCount = geminiResult.calculation_details.length;

  logger.info("Savings calculation summary", {
    total_matches: matches.length,
    calculated_locally: localCount,
    calculated_with_gemini: geminiCount,
    efficiency_percent:
      matches.length > 0
        ? Math.round((localCount / matches.length) * 100)
        : 100,
    calculation_details: allDetails,
  });

  return finalSavingsByCurrency;
};

export const batchMatchWithGemini = async (
  itemsWithCandidates: { item: string; candidates: ProductCandidate[] }[],
  ai: GoogleGenAI,
): Promise<MatchedProduct[]> => {
  if (itemsWithCandidates.length === 0) {
    return [];
  }

  const candidatesMap = new Map<string, ProductCandidate>();
  const promptData = itemsWithCandidates.map(({ item, candidates }) => {
    candidates.forEach((c) => candidatesMap.set(c.id, c));
    return {
      shopping_list_item: item,
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
Task: For each shopping list item, find the best matching discounted product from the provided candidates.

Here is the list of shopping items and their potential product matches:
${JSON.stringify(promptData, null, 2)}

Instructions:
1. For each shopping list item, evaluate its candidates to find the single best match.
2. A match is valid ONLY if the product is a good fit for discounting the shopping list item. Consider all attributes.
3. The 'similarity_score' is a hint, but use your judgment.
4. Only return a match if your confidence is 60 or higher (out of 100).
5. If no candidate is a good match, do not include it in your response.

Output Format (JSON Array):
[
  {
    "shopping_list_item": "The original shopping list item string",
    "matched_candidate_id": "The id of the chosen candidate product",
    "confidence_score": number (0-100),
    "is_exact_match": boolean
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
      matched_candidate_id: string;
      confidence_score: number;
      is_exact_match: boolean;
    };

    const geminiResponse: GeminiBatchResponseItem[] = JSON.parse(responseText);

    const matches: MatchedProduct[] = [];
    for (const item of geminiResponse) {
      const matchedProduct = candidatesMap.get(item.matched_candidate_id);
      if (matchedProduct) {
        matches.push({
          shopping_list_item: item.shopping_list_item,
          matched_product: matchedProduct,
          confidence_score: item.confidence_score,
          is_exact_match: item.is_exact_match,
        });
      } else {
        logger.warn(
          "Gemini returned a match for a candidate_id that was not found",
          {
            response_item: item,
          },
        );
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
