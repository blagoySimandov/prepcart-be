import { ProductCandidate, ShoppingListItem } from "../types";
export * from "../types";

export interface ShoppingListRequest {
  shopping_list: ShoppingListItem[];
  country?: string;
  store_ids?: string[];
  max_results_per_item?: number;
  discount_language?: string;
}

export interface MatchedProduct {
  shopping_list_item: ShoppingListItem;
  matched_products: ProductCandidate[];
}

export interface ShoppingListResponse {
  matches: MatchedProduct[];
  unmatched_items: string[];
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
