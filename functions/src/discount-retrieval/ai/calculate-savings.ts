import { GoogleGenAI } from "@google/genai";
import { MatchedProduct } from "../types";
import { logger } from "firebase-functions/v2";
import { CHEAP_MODEL_NAME } from "../constants";

export interface QuantityMultiplierResult {
  updated_matches: MatchedProduct[];
}

const calculateQuantityMultipliers = async (
  matches: MatchedProduct[],
  ai: GoogleGenAI
): Promise<QuantityMultiplierResult> => {
  if (matches.length === 0) {
    return { updated_matches: [] };
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
        price_before_discount_local: bestProduct.price_before_discount_local,
        currency_local: bestProduct.currency_local,
        product_id: bestProduct.id,
      };
    })
    .filter(Boolean);

  logger.info("Requesting quantity multipliers from Gemini", {
    matchesData,
  });

  const prompt = `
Calculate quantity multipliers. Products are sold per piece/package, not per gram/ml.

Data:
${JSON.stringify(matchesData, null, 2)}

Examples:
- User wants "1 cheese", product is "500g cheese" → multiplier = 1 (1 package)
- User wants "2 milk", product is "1L milk" → multiplier = 2 (2 bottles)  
- User wants "500g cheese", product is "250g cheese" → multiplier = 2 (2 packages)

IMPORTANT: Return EXACTLY this JSON structure:
{
  "quantity_calculations": [
    {
      "id": "0",
      "quantity_multiplier": 1
    },
    {
      "id": "1", 
      "quantity_multiplier": 2
    }
  ]
}

Never return null for quantity_multiplier - use 1 as default.
`;
  const result = await ai.models.generateContent({
    model: CHEAP_MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const responseText = result.text;
  if (!responseText) {
    logger.warn("Gemini returned no response for quantity calculation.");
    return { updated_matches: [] };
  }

  try {
    const { quantity_calculations: quantityCalculations } = JSON.parse(responseText);

    const updatedMatches = matches.map((match) => {
      const matchData = matchesData.find((m) => m?.product_id === match.matched_products[0]?.id);
      const calc = quantityCalculations.find((c: any) => c.id === matchData?.id);

      if (matchData && calc) {
        logger.info("Applied quantity multiplier", {
          shopping_item: matchData.shopping_item.item,
          product_quantity: matchData.product_quantity,
          quantity_multiplier: calc.quantity_multiplier,
        });

        // Add quantity multiplier to the best product
        const updatedProducts = match.matched_products.map((product, index) => {
          if (index === 0) {
            // Best product gets the quantity multiplier
            return {
              ...product,
              quantity_multiplier: calc.quantity_multiplier,
            };
          }
          return product;
        });

        return {
          ...match,
          matched_products: updatedProducts,
        };
      }
      return match;
    });

    return { updated_matches: updatedMatches };
  } catch (error) {
    logger.error("Error parsing savings calculation response from Gemini", {
      error: error instanceof Error ? error.message : "Unknown error",
      response: responseText,
    });
    return { updated_matches: [] };
  }
};

export { calculateQuantityMultipliers };
