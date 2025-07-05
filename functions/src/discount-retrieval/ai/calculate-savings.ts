import { GoogleGenAI } from "@google/genai";
import { MatchedProduct } from "../types";
import { logger } from "firebase-functions/v2";
import { CHEAP_MODEL_NAME } from "../constants";

type SavingsByCurrency = { [currency: string]: number };

export interface SavingsCalculationResult {
  savings_by_currency: SavingsByCurrency;
}

const calculateSavings = async (
  matches: MatchedProduct[],
  ai: GoogleGenAI,
): Promise<SavingsCalculationResult> => {
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
        price_before_discount_local: bestProduct.price_before_discount_local,
        currency_local: bestProduct.currency_local,
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
    logger.warn("Gemini returned no response for savings calculation.");
    return { savings_by_currency: {} };
  }

  try {
    const { quantity_calculations: quantityCalculations } = JSON.parse(responseText);

    const savingsByCurrency: SavingsByCurrency = {};

    (quantityCalculations as { id: string; quantity_multiplier: number }[]).forEach((calc) => {
      const match = matchesData.find((m) => m?.id === calc.id);
      if (match) {
        const savings = match.price_before_discount_local * calc.quantity_multiplier;
        savingsByCurrency[match.currency_local] =
          (savingsByCurrency[match.currency_local] || 0) + savings;
      }
    });
    return { savings_by_currency: savingsByCurrency };
  } catch (error) {
    logger.error("Error parsing savings calculation response from Gemini", {
      error: error instanceof Error ? error.message : "Unknown error",
      response: responseText,
    });
    return { savings_by_currency: {} };
  }
};

export { calculateSavings };
