import { MatchedProduct } from "../types";

type TranslationPromptData = {
  shopping_list_item: string[];
  discount_language: string;
};
export type TranslationJsonResponse = {
  result: {
    discountLanguage: string[];
    english: string[];
  };
};
const translationPrompt = (data: TranslationPromptData) => `
Task: Translate the following shopping list items into the "discount language" and into English.

Shopping List Items:
${JSON.stringify(data.shopping_list_item)}

Discount Language: ${data.discount_language}

Instructions:
1. Translate each item in the shopping list into the specified discount language
2. Translate each item in the shopping list into English
3. Maintain the exact same order as the input items
4. Return exactly the same number of translations as input items
5. Use the exact JSON format specified below

Output Format (JSON):
{
  "result": {
    "discountLanguage": ["translation1", "translation2", "translation3", "translation4"],
    "english": ["english1", "english2", "english3", "english4"]
  }
}

Important: The arrays must contain exactly ${
  data.shopping_list_item.length
} items each, in the same order as the input.
`;

type FilterCandidatesPromptData = {
  shoppingListWithCandidates: MatchedProduct[];
};
export type FilterCandidatesJsonResponse = {
  shopping_list_item: string;
  matched_candidates: {
    id: string;
    confidence_score: number;
    is_exact_match: boolean;
  }[];
}[];

const filterCandidatesPrompt = (data: FilterCandidatesPromptData) => {
  const promptData = data.shoppingListWithCandidates.map(
    ({ shopping_list_item: shoppingListItem, matched_products: matchedProducts }) => {
      return {
        shopping_list_item: shoppingListItem.item,
        shopping_item_quantity: shoppingListItem.quantity,
        shopping_item_unit: shoppingListItem.unit,
        candidates: matchedProducts.map((c) => ({
          id: c.id,
          product_name: c.product_name,
          discount_percent: c.discount_percent,
          price_before_discount_local: c.price_before_discount_local,
          currency_local: c.currency_local,
          quantity: c.quantity,
          store_id: c.store_id,
          similarity_score: c.similarity_score.toFixed(3),
          requires_loyalty_card: c.requires_loyalty_card,
        })),
      };
    }
  );

  return `
Task: For each shopping list item, find all matching discounted products from the provided candidates.

Here is the list of shopping items and their potential product matches:
${JSON.stringify(promptData, null, 2)}

Instructions:
1. For each shopping list item, evaluate its candidates to find all that match the item.
2. A match is valid ONLY if the product is a good fit for discounting the shopping list item. Consider all attributes.
3. The 'similarity_score' is a hint, but use your judgment.
4. Reorder the matched candidates so that the best match is the FIRST element in the list. The order of the rest does not matter.
5. If there are multiple candidates that seem equally like the best match, pick the one with the greater discount_percent as the first element.
6. If no candidate is a good match, do not include it in your response.

Output Format (JSON Array):
[
  {
    "shopping_list_item": "The original shopping list item string",
    "matched_candidates": [
      {
        "id": "The id of a chosen candidate product",
        "confidence_score": number (0-100),
        "is_exact_match": boolean
      }
    ]
  }
]
`;
};
export const PROMPTS = {
  translationPrompt,
  filterCandidatesPrompt,
};
