import { ProductCandidate } from "../types";
import { searchSimilarProducts } from "../util/database-vector-search";

const MAX_VECTOR_SEARCH_RESULTS = 10;
export async function extractCandidateArrays(
  embeddingsDiscountLang: Map<string, number[] | null>,
  embeddingsEnglish: Map<string, number[] | null>,
  discountLanguageTranslations: string[],
  englishTranslations: string[],
  country?: string,
  storeIds?: string[],
) {
  const englishCandidates: ProductCandidate[][] = [];
  const discountLanguageCandidates: ProductCandidate[][] = [];

  const maxLength = Math.max(discountLanguageTranslations.length, englishTranslations.length);

  for (let i = 0; i < maxLength; i++) {
    const englishItem = englishTranslations[i];
    if (englishItem) {
      const englishEmbedding = embeddingsEnglish.get(englishItem);
      if (englishEmbedding) {
        const candidates = await searchSimilarProducts({
          queryEmbedding: englishEmbedding,
          country,
          storeIds,
          maxResults: MAX_VECTOR_SEARCH_RESULTS,
        });
        englishCandidates.push(candidates);
      } else {
        englishCandidates.push([]);
      }
    } else {
      englishCandidates.push([]);
    }

    const discountLangItem = discountLanguageTranslations[i];
    if (discountLangItem) {
      const discountLangEmbedding = embeddingsDiscountLang.get(discountLangItem);
      if (discountLangEmbedding) {
        const candidates = await searchSimilarProducts({
          queryEmbedding: discountLangEmbedding,
          country,
          storeIds,
          maxResults: MAX_VECTOR_SEARCH_RESULTS,
        });
        discountLanguageCandidates.push(candidates);
      } else {
        discountLanguageCandidates.push([]);
      }
    } else {
      discountLanguageCandidates.push([]);
    }
  }

  return { englishCandidates, discountLanguageCandidates };
}
