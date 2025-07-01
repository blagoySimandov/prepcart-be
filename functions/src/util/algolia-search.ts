import { algoliasearch } from "algoliasearch";

const ALGOLIA_APP_ID = "T4UOWXSOVE";
const ALGOLIA_INDEX_NAME = "discounted_products";

export const searchProductsWithAlgolia = async (
  query: string,
  algoliaApiKey: string,
  country?: string,
  storeIds?: string[],
  maxResults = 10
) => {
  try {
    const client = algoliasearch(ALGOLIA_APP_ID, algoliaApiKey);

    const filters: string[] = [];
    if (country) {
      filters.push(`country:${country}`);
    }
    if (storeIds && storeIds.length > 0) {
      const storeFilters = storeIds.map((id) => `store_id:${id}`).join(" OR ");
      filters.push(`(${storeFilters})`);
    }

    const searchParams = {
      query,
      hitsPerPage: maxResults,
      filters: filters.length > 0 ? filters.join(" AND ") : undefined,
    };

    const response = await client.searchSingleIndex({
      indexName: ALGOLIA_INDEX_NAME,
      searchParams,
    });

    return response.hits;
  } catch (error) {
    console.error("Algolia search error:", error);
    return [];
  }
};
