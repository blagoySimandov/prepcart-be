import { onCall } from "firebase-functions/v2/https";
import * as https from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { initializeAppIfNeeded } from "../util/firebase";
import { defineSecret } from "firebase-functions/params";
import { ClassifyInputResponse } from "./types";

initializeAppIfNeeded();
const MODEL_NAME = "gemini-2.0-flash-lite";
const API_KEY_SECRET = defineSecret("API_KEY");

export const classifyInput = onCall(
  { secrets: [API_KEY_SECRET], region: "europe-west1", cors: true },
  async (request): Promise<ClassifyInputResponse> => {
    const apiKey = API_KEY_SECRET.value();
    const text = request.data.text;

    if (!text) {
      throw new https.HttpsError(
        "invalid-argument",
        "The function must be called with one argument 'text' containing the text to classify."
      );
    }

    if (!apiKey) {
      throw new https.HttpsError(
        "failed-precondition",
        "The API key is not configured."
      );
    }

    const genAI = new GoogleGenAI({ apiKey });

    const prompt = `
Task: Parse a shopping list item into a JSON object with "product_name", "quantity", and "category".

Examples:
- "Wine 2 bottles" -> {"product_name": "Wine", "quantity": "2 bottles", "category": "Alcoholic Beverages"}
- "Ground beef 500g" -> {"product_name": "Ground beef", "quantity": "500g", "category": "Meat"}
- "Milk" -> {"product_name": "Milk", "category": "Dairy"}

Input: "${text}"
Output:`;

    try {
      const result = await genAI.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" },
      });

      const responseText = result.text;
      if (!responseText) {
        throw new Error("No response from Gemini.");
      }
      return JSON.parse(responseText);
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      throw new https.HttpsError(
        "internal",
        "Failed to classify input.",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }
);
