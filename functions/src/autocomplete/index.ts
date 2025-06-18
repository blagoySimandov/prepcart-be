/* eslint-disable valid-jsdoc */
import { onCall } from "firebase-functions/v2/https";
import * as https from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { initializeAppIfNeeded } from "../util/firebase";
import { defineSecret } from "firebase-functions/params";

initializeAppIfNeeded();
const MODEL_NAME = "gemini-2.5-flash-lite-preview-06-17";
const API_KEY_SECRET = defineSecret("API_KEY");

/**
 * Provides autocomplete suggestions for a shopping list item.
 */
export const autocomplete = onCall(
  { secrets: [API_KEY_SECRET] },
  async (request) => {
    const apiKey = API_KEY_SECRET.value();
    const text = request.data.text;
    if (!text) {
      throw new https.HttpsError(
        "invalid-argument",
        "The function must be called with one argument 'text' containing the text to autocomplete.",
      );
    }

    if (!apiKey) {
      throw new https.HttpsError(
        "failed-precondition",
        "The GEMINI_API_KEY environment variable is not set.",
      );
    }

    const genAI = new GoogleGenAI({ apiKey });

    const prompt = `Complete the last word in this shopping list input: "${text}"

    Return only the remaining characters needed to finish the current word. Focus on common shopping items and quantities.
    
    Examples:
    - "Wine 2 bo" → {"suggestion": "ttles"}
    - "Organic bana" → {"suggestion": "nas"}
    - "Milk" → {"suggestion": ""}
    
    Return JSON: {"suggestion": "remaining_characters"}`;

    try {
      const result = await genAI.models.generateContent({
        model: MODEL_NAME,
        contents: [{ parts: [{ text: prompt }] }],
      });

      const suggestionText = result.text || "";

      const cleanedText = suggestionText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      const jsonResponse = JSON.parse(cleanedText);
      return jsonResponse;
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      throw new https.HttpsError(
        "internal",
        "Failed to get autocomplete suggestion.",
      );
    }
  },
);
