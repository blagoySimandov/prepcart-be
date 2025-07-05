export type GeminiBatchResponseItem = {
  shopping_list_item: string;
  matched_candidates: {
    id: string;
    confidence_score: number;
    is_exact_match: boolean;
  }[];
};
