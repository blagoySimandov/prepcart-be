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
      const page = request.data.page || 0;
      const country = request.data.country;
      const storeIds = request.data.store_ids;
      const response = await searchProductsWithAlgolia(
        query,
        algoliaApiKey,
        country,
        storeIds,
        maxResults,
        page
      );

      const transformedHits = (response.hits || []).map((hit: any) => ({
        id: hit.id,
        objectID: hit.objectID,
        productName: hit["discount.product_name"],
        priceBeforeDiscount: hit["discount.price_before_discount_local"],
        discountPercent: hit["discount.discount_percent"],
        pageNumber: hit["discount.page_number"],
        storeId: hit.storeId,
        country: hit.country,
        sourceFileUri: hit.sourceFileUri,
        validUntil: hit.validUntil,
        // Add any other fields your frontend needs
      }));

      // Return consistent structure with pagination info
      return {
        results: transformedHits,
        page: response.page || 0,
        totalPages: response.nbPages || 0,
        totalResults: response.nbHits || 0,
        hasMore: (response.page || 0) < (response.nbPages || 1) - 1,
      };
    } catch (err) {
      logger.error("Algolia search failed", err);
      throw new functions.https.HttpsError(
        "internal",
        "Error performing search"
      );
    }
  }
);
