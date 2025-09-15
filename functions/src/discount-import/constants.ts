import { defineSecret } from "firebase-functions/params";
import { API_KEY_SECRET_LITERAL } from "../constants";

export const API_KEY_SECRET = defineSecret(API_KEY_SECRET_LITERAL);
export const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
export const TARGET_STORAGE_BUCKET = process.env.GCLOUD_PROJECT + ".firebasestorage.app";
export const PRODUCTS_COLLECTION = "products";
export const BROCHURES_COLLECTION = "crawled_brochures";
export const MAX_PAGES_PER_CHUNK = 20;

export const PROMPT_FOR_DISCOUNT_EXTRACTION = `
Task: Extract all products that have a clear discount from the provided content.
Output Format: Return a JSON object with a "discounted_products" key.
<json example>
{
  "discounted_products": [
    {
      "product_name": "string",
      "price_before_discount_local": number,
      "currency_local": "string", // e.g. "EUR", "BGN", "USD", "GBP"
      "quantity": string, // The quantity for which the product is priced at. e.g. "1 pcs", "1 kg"  or "1 bottle"
      "discount_percent": number,
      "page_number": number,
      "requires_loyalty_card": boolean // true if the discount requires a loyalty card, membership, or special customer card
      "valid_from": string, // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DD
      "valid_until": string // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DD
    }
    ...
  ]
}
</json example>

Requirements:
- Include only products with a clear, stated discount percentage
- The "discount_percent" field MUST be an integer. If you see a decimal, round it to the nearest whole number
- Use the EXACT price as shown in the PDF in its original currency for "price_before_discount_local"
- Use the correct currency code (EUR, BGN, USD, GBP, etc.) for "currency_local"
- Set "requires_loyalty_card" to true if the discount mentions requirements like: loyalty card, membership card, club card, customer card, VIP card, rewards card, or similar membership requirements
- Set "requires_loyalty_card" to false if no membership requirements are mentioned or if the discount is available to all customers
- For "valid_from" and "valid_until", use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ) or simple date format (YYYY-MM-DD). If exact dates are not available, estimate based on the promotional period of the brochure
- Ensure all fields are filled where information is available
- Ensure product names are in the language of the PDF
- Round prices to 2 decimal places
`;
