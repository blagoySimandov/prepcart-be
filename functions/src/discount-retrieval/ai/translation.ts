import { GoogleGenAI } from "@google/genai";
import { CHEAP_MODEL_NAME } from "../constants";
import { PROMPTS, TranslationJsonResponse } from "./prompts";

export async function translateShoppingListItems(
  ai: GoogleGenAI,
  items: string[],
  discountlanguage: string,
) {
  const prompt = PROMPTS.translationPrompt({
    shopping_list_item: items,
    discount_language: discountlanguage,
  });

  const response = await ai.models.generateContent({
    model: CHEAP_MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseMimeType: "application/json" },
  });

  if (!response.text) {
    throw new Error("Failed to translate shopping list items");
  }

  return JSON.parse(response.text) as TranslationJsonResponse;
}
