import { defineSecret } from "firebase-functions/params";
import { API_KEY_SECRET, EMBEDDING_MODEL } from "../constants";
import { HttpsOptions } from "firebase-functions/https";
export { EMBEDDING_MODEL };

export const MODEL_NAME = "gemini-2.5-flash-lite-preview-06-17";
export const CHEAP_MODEL_NAME = "gemini-2.0-flash-lite";
export const DEFAULT_PREFFERED_CURRENCY = "BGN";
export const DEFAULT_DISCOUNT_LANGUAGE = "Bulgarian";

export const apiKeySecret = defineSecret(API_KEY_SECRET);
export const FUNCTION_CONFIG: HttpsOptions = {
  memory: "1GiB",
  timeoutSeconds: 300,
  secrets: [apiKeySecret],
  region: "europe-west1",
  cors: true,
};
