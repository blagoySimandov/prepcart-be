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
  confidence_score?: number;
  is_exact_match?: boolean;
  requires_loyalty_card: boolean;
}
