import { GoogleGenAI } from "@google/genai";
import { MatchedProduct } from "../types";
import { logger } from "firebase-functions/v2";
import { MODEL_NAME } from "../constants";

export interface QuantityMultiplierResult {
  updated_matches: MatchedProduct[];
}

interface QuantityCalculation {
  id: string;
  quantity_multiplier: number;
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
      };
    })
    .filter(Boolean);

  logger.info("Requesting quantity multipliers from Gemini", {
    matchesData,
  });

  const prompt = `Your task is to calculate a "quantity_multiplier" for each item in the provided data.
This multiplier represents how many units of the 'product' the user needs to buy to fulfill their 'shopping_item' request.

Key considerations:
1.  **Focus on Quantity:** The core of the task is to compare the quantity requested by the user (\`shopping_item.quantity\`) with the quantity of the product (\`product_quantity\`).
2.  **Product Unit:** The \`product_quantity\` describes a single unit of the product being sold (e.g., "1 pcs", "250g", "1L").
3.  **User Request:** The \`shopping_item\` describes what the user wants (e.g., { "item": "Wine", "quantity": 2, "unit": "bottles" } means the user wants 2 bottles of wine).
4.  **Logical Inference:** You must infer the relationship. If the user wants 2 bottles of wine and the product is 1 bottle of wine (even if described as "1 pcs"), the multiplier is 2.

Here is the data:
${JSON.stringify(matchesData, null, 2)}

Examples of logic:
- User wants { "item": "cheese", "quantity": 1 }, product is "500g cheese" -> multiplier = 1 (user wants one pack of cheese, the product is one pack).
- User wants { "item": "milk", "quantity": 2 }, product is "1L milk" -> multiplier = 2 (user wants 2 milks, the product is 1 milk).
- User wants { "item": "milk", "quantity": 2, "unit": "bottles" }, product is "1L milk" -> multiplier = 2 (user wants 2 bottles, the product is 1 bottle).
- User wants { "item": "cheese", "quantity": 500, "unit": "g" }, product is "250g cheese" -> multiplier = 2 (user needs two 250g packs to get 500g).
- User wants { "item": "Wine", "quantity": 2, "unit": "bottles" }, product is "1 pcs" of Wine -> multiplier = 2.

IMPORTANT: Return EXACTLY this JSON structure. Do not add comments or change the structure.
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

If you cannot determine a multiplier, default to 1. Never return null for quantity_multiplier.
`;
  const result = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.0,
    },
  });

  const responseText = result.text;
  if (!responseText) {
    logger.warn("Gemini returned no response for quantity calculation.");
    return { updated_matches: [] };
  }

  try {
    const { quantity_calculations: quantityCalculations } = JSON.parse(responseText) as {
      quantity_calculations: QuantityCalculation[];
    };

    const updatedMatches = matches.map((match, index) => {
      const calc = quantityCalculations.find((c) => c.id === index.toString());

      const matchData = matchesData[index];

      if (calc && matchData) {
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
