import { FieldValue } from "firebase-admin/firestore";

// Core discount/product types shared across modules
export interface DiscountDetails {
  product_name: string;
  price_before_discount_local: number;
  quantity: string;
  currency_local: string;
  discount_percent: number;
  page_number: number;
  requires_loyalty_card: boolean;
}

export interface Product {
  id: string;
  sourceFileUri: string;
  storeId: string;
  country: string;
  validFrom: Date;
  validUntil: Date;
  isEmbedded: boolean;
  createdAt: FieldValue;
  discount: DiscountDetails;
  embedding?: number[];
}

// Search/retrieval types
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
  // Quantity information for client-side calculations
  quantity_multiplier?: number;
}

export interface ShoppingListItem {
  item: string;
  quantity?: number;
  unit?: string;
}
