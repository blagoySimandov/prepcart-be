/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import FirecrawlApp from "@mendable/firecrawl-js";

export const scrapeUrl = onRequest(async (request, response) => {
  try {
    const { url } = request.body;

    if (!url) {
      response.status(400).json({ error: "URL is required" });
      return;
    }

    // TODO: Firecrawl API key should be stored in SecretsManager
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      response.status(500).json({ error: "Firecrawl API key not configured" });
      return;
    }

    const app = new FirecrawlApp({ apiKey });
    const scrapeResult = await app.scrapeUrl(url, {
      formats: ["markdown", "html"],
    });

    if (!scrapeResult.success) {
      response.status(500).json({
        error: "Failed to scrape URL",
        details: scrapeResult.error,
      });
      return;
    }

    response.json({
      success: true,
      data: scrapeResult,
    });
  } catch (error) {
    logger.error("Error scraping URL:", error);
    response.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
