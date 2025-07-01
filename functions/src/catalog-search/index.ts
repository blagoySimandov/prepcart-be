import * as functions from "firebase-functions";
import * as logger from "firebase-functions/logger";
import { searchProductsWithAlgolia } from "../util/algolia-search";
import { defineSecret } from "firebase-functions/params";

const DEFAULT_MAX_RESULTS = 10;
const ALGOLIA_API_KEY = defineSecret("ALGOLIA_API_KEY");

export const catalogSearch = functions.https.onCall(
  {
    secrets: [ALGOLIA_API_KEY],
  },
  async (request) => {
    const data = request.data;
    const query = data.query;
    const uid = request.auth?.uid;
    const algoliaApiKey = ALGOLIA_API_KEY.value();

    logger.info("Catalog search request received", { query, uid });

    if (!query) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "No query provided."
      );
    }

    try {
      const maxResults = request.data.max_results || DEFAULT_MAX_RESULTS;
      const country = request.data.country;
      const storeIds = request.data.store_ids;
      const results = await searchProductsWithAlgolia(
        query,
        algoliaApiKey,
        country,
        storeIds,
        maxResults
      );

      return { results };
    } catch (err) {
      logger.error("Algolia search failed", err);
      throw new functions.https.HttpsError(
        "internal",
        "Error performing search"
      );
    }
  }
);
