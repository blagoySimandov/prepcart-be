import { FieldValue } from "firebase-admin/firestore";

export interface DiscountDetails {
  product_name: string;
  price_before_discount_local: number;
  quantity: string;
  currency_local: string;
  discount_percent: number;
  page_number: number;
}

export interface AnalysisResult {
  discounted_products: DiscountDetails[];
}

export interface Product {
  id: string;
  sourceFileUri: string;
  storeId: string;
  country: string;
  isEmbedded: boolean;
  createdAt: FieldValue;
  archivedAt: FieldValue | null;
  discount: DiscountDetails;
  embedding?: number[];
}
