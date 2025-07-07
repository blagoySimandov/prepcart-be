// Re-export shared types for backward compatibility
export { ProductCandidate } from "../types";

type TypesenseDiscount = {
  product_name?: string;
  discount_percent?: number;
  price_before_discount_local?: number;
  currency_local?: string;
  quantity?: string;
  page_number?: number;
  requires_loyalty_card?: boolean;
};

export type TypesenseDocument = {
  id: string;
  storeId?: string;
  country?: string;
  discount?: TypesenseDiscount;
};
