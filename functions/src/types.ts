import { FieldValue } from "firebase-admin/firestore";

export interface DiscountedProduct {
  product_name: string;
  price_before_discount_local: number;
  currency_local: string;
  price_before_discount_eur: number;
  discount_percent: number;
  page_number: number;
}

export interface AnalysisResult {
  discounted_products: DiscountedProduct[];
}

export interface PdfAnalysisResult {
  fileUri: string;
  bucket: string;
  status: "completed" | "completed_no_text_response" | "error";
  extractedData?: AnalysisResult;
  errorMessage?: string;
  errorDetails?: string;
  timestamp: FieldValue;
}
