import { algoliasearch } from "algoliasearch";

const ALGOLIA_APP_ID = "T4UOWXSOVE";
const ALGOLIA_INDEX_NAME = "discounted_products";

export const searchProductsWithAlgolia = async (
  query: string,
  algoliaApiKey: string,
  country?: string,
  storeIds?: string[],
  maxResults = 10,
  page = 0,
) => {
  try {
    const client = algoliasearch(ALGOLIA_APP_ID, algoliaApiKey);

    const filters: string[] = [];

    const currentTimestamp = Math.floor(Date.now() / 1000);
    filters.push(`validUntil >= ${currentTimestamp}`);
    filters.push(`validFrom <= ${currentTimestamp}`);

    if (country) {
      filters.push(`country:${country}`);
    }
    if (storeIds && storeIds.length > 0) {
      const storeFilters = storeIds.map((id) => `storeId:${id}`).join(" OR ");
      filters.push(`(${storeFilters})`);
    }

    const searchParams = {
      query,
      hitsPerPage: maxResults,
      page,
      filters: filters.length > 0 ? filters.join(" AND ") : undefined,
    };

    console.log("Algolia search params:", {
      ...searchParams,
      algoliaApiKey: "***",
    });

    const response = await client.searchSingleIndex({
      indexName: ALGOLIA_INDEX_NAME,
      searchParams,
    });

    console.log("Algolia response pagination:", {
      page: response.page,
      nbPages: response.nbPages,
      hitsPerPage: response.hitsPerPage,
      nbHits: response.nbHits,
    });

    return response;
  } catch (error) {
    console.error("Algolia search error:", error);
    return {
      hits: [],
      page: 0,
      nbPages: 0,
      hitsPerPage: maxResults,
      nbHits: 0,
      processingTimeMS: 0,
      query: query,
    };
  }
};
