import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { ShoppingListItem } from "../../types";
import { MODEL_NAME } from "../../constants";

export const translateShoppingList = async (
  shoppingList: ShoppingListItem[],
  targetLanguage: string,
  ai: GoogleGenAI
): Promise<Map<string, string>> => {
  const itemsToTranslate = shoppingList.map((item) => item.item);
  const prompt = `
Translate the following shopping list items to ${targetLanguage}.
Return a JSON object where keys are the original items and values are the translations.

Example Output for language BG:
{
  "Wine 2 bottles": "Вино 2 бутилки",
  "Meat": "Месо",
  "Milk": "Мляко"
}

Items:
${JSON.stringify(itemsToTranslate)}

JSON Output:
`;
  logger.info("Translating shopping list items to " + targetLanguage);

  try {
    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });

    const responseText = result.text;
    if (!responseText) {
      throw new Error("No response from Gemini for translation.");
    }
    const translationMap = JSON.parse(responseText);
    logger.info("Translated shopping list items", { translationMap });
    return new Map(Object.entries(translationMap));
  } catch (error) {
    logger.error("Failed to translate shopping list", {
      error: error instanceof Error ? error.message : "Unknown error",
      targetLanguage,
    });
    return new Map(itemsToTranslate.map((item) => [item, item]));
  }
};
