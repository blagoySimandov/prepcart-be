import { logger } from "firebase-functions/v2";
import { ProductCandidate } from "./types";
import { getFirestore } from "firebase-admin/firestore";
import { PRODUCTS_COLLECTION } from "../constants";

const db = getFirestore();

export const searchSimilarProducts = async (
  queryEmbedding: number[],
  country?: string,
  storeIds?: string[],
  maxResults = 10
): Promise<ProductCandidate[]> => {
  const collection = db.collection(PRODUCTS_COLLECTION);

  let query = collection
    .where("validUntil", ">=", new Date())
    .where("isEmbedded", "==", true);

  if (country) {
    query = query.where("country", "==", country);
  }

  if (storeIds && storeIds.length > 0) {
    query = query.where("storeId", "in", storeIds);
  }

  try {
    const vectorQuery = query.findNearest({
      vectorField: "embedding",
      queryVector: queryEmbedding,
      limit: maxResults,
      distanceMeasure: "COSINE",
      distanceResultField: "similarity_score",
    });

    const snapshot = await vectorQuery.get();

    const candidates: ProductCandidate[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const product = data;

      candidates.push({
        id: product.id,
        product_name: product.discount.product_name,
        store_id: product.storeId,
        country: product.country,
        discount_percent: product.discount.discount_percent,
        price_before_discount_local:
          product.discount.price_before_discount_local,
        currency_local: product.discount.currency_local,
        quantity: product.discount.quantity,
        page_number: product.discount.page_number,
        similarity_score: data.similarity_score || 0,
        requires_loyalty_card: product.discount.requires_loyalty_card || false,
      });
    });

    return candidates;
  } catch (error) {
    logger.warn("Vector search failed, falling back to regular query", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
};
