import { ProductCandidate } from "../types";
import { searchSimilarProducts } from "../util/database-vector-search";

const MAX_VECTOR_SEARCH_RESULTS = 10;
export async function extractCandidateArrays(
  embeddingsDiscountLang: Map<string, number[]>,
  embeddingsEnglish: Map<string, number[]>,
  country?: string,
  storeIds?: string[],
) {
  const englishCandidates: ProductCandidate[][] = [];
  const discountLanguageCandidates: ProductCandidate[][] = [];

  for (const [, queryEmbedding] of embeddingsDiscountLang) {
    const candidates = await searchSimilarProducts({
      queryEmbedding,
      country,
      storeIds,
      maxResults: MAX_VECTOR_SEARCH_RESULTS,
    });
    englishCandidates.push(candidates);
  }

  for (const [, queryEmbedding] of embeddingsEnglish) {
    const candidates = await searchSimilarProducts({
      queryEmbedding,
      country,
      storeIds,
      maxResults: MAX_VECTOR_SEARCH_RESULTS,
    });
    discountLanguageCandidates.push(candidates);
  }

  return { englishCandidates, discountLanguageCandidates };
}
