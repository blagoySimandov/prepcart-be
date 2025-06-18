export interface ShoppingListItem {
  item: string;
  quantity?: number;
  notes?: string;
}

export interface ShoppingListRequest {
  shopping_list: ShoppingListItem[];
  country?: string;
  store_ids?: string[];
  max_results_per_item?: number;
}

export interface ProductCandidate {
  id: string;
  product_name: string;
  store_id: string;
  country: string;
  discount_percent: number;
  price_before_discount_local: number;
  currency_local: string;
  quantity: string;
  page_number: number;
  similarity_score: number;
}

export interface MatchedProduct {
  shopping_list_item: string;
  matched_product: ProductCandidate;
  confidence_score: number;
  is_exact_match: boolean;
}

export interface ShoppingListResponse {
  matches: MatchedProduct[];
  unmatched_items: string[];
  total_potential_savings_by_currency: { [currency: string]: number };
  processing_time_ms: number;
}

export interface SavingsCalculationDetail {
  shopping_item: string;
  product_name: string;
  savings: number;
  currency: string;
  used_local_calculation: boolean;
}

export interface ParsedQuantity {
  isAmbiguous: boolean;
}
