import { Client as TypesenseClient } from "typesense";
import { logger } from "firebase-functions/v2";
import { ProductCandidate, TypesenseDocument } from "./types";
import { defineSecret } from "firebase-functions/params";

const TYPESENSE_HOST = "p8qx4bsv7e5hfrnwp-1.a1.typesense.net";
const TYPESENSE_PORT = 443;
const TYPESENSE_PROTOCOL = "https";
const TYPESENSE_SECRET = "TYPESENSE_KEY";
export const typesenseKeySecret = defineSecret(TYPESENSE_SECRET);
const COLLECTION_NAME = "products";

type SearchProductsOptions = {
  query: string;
  apiKey: string;
  country?: string;
  storeIds?: string[];
  maxResults?: number;
};

export async function searchProductsWithTypesense({
  query,
  country,
  storeIds,
  maxResults = 10,
  apiKey,
}: SearchProductsOptions): Promise<ProductCandidate[]> {
  try {
    const client = new TypesenseClient({
      nodes: [
        {
          host: TYPESENSE_HOST,
          port: TYPESENSE_PORT,
          protocol: TYPESENSE_PROTOCOL,
        },
      ],
      apiKey,
      connectionTimeoutSeconds: 10,
    });
    const filters: string[] = [];

    const currentTimestamp = Math.floor(Date.now() / 1000);
    filters.push(`validFrom:<=${currentTimestamp}`);
    filters.push(`validUntil:>=${currentTimestamp}`);

    if (country) {
      filters.push(`country:=${country}`);
    }

    if (storeIds && storeIds.length > 0) {
      const storeFilter = storeIds.map((id) => `storeId:=${id}`).join(" || ");
      filters.push(`(${storeFilter})`);
    }

    const searchParameters = {
      q: query,
      query_by: "discount.product_name",
      filter_by: filters.join(" && "),
      per_page: maxResults,
      page: 1,
      sort_by: "_text_match:desc",
    };

    logger.info("Typesense search parameters", { searchParameters });

    const searchResults = await client
      .collections(COLLECTION_NAME)
      .documents()
      .search(searchParameters);

    logger.info("Typesense search results", {
      found: searchResults.found,
      hits: searchResults.hits?.length || 0,
    });

    const candidates: ProductCandidate[] = [];

    if (searchResults.hits) {
      for (const hit of searchResults.hits) {
        const document = hit.document as TypesenseDocument;

        candidates.push({
          id: document.id,
          product_name: document.discount?.product_name || "",
          store_id: document.storeId || "",
          country: document.country || "",
          discount_percent: document.discount?.discount_percent || 0,
          price_before_discount_local: document.discount?.price_before_discount_local || 0,
          currency_local: document.discount?.currency_local || "",
          quantity: document.discount?.quantity || "",
          page_number: document.discount?.page_number || 0,
          similarity_score: Number(hit.text_match_info?.score) || 0,
          requires_loyalty_card: document.discount?.requires_loyalty_card || false,
        });
      }
    }

    logger.info("Processed candidates", { count: candidates.length });

    return candidates;
  } catch (error) {
    logger.error("Typesense search failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      query,
      country,
      storeIds,
    });
    return [];
  }
}
