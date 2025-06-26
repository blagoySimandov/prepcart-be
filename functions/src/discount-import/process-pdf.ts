import { onObjectFinalized } from "firebase-functions/v2/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initializeAppIfNeeded } from "../util/firebase";
import { DiscountDetails, AnalysisResult, Product } from "./types";

initializeAppIfNeeded();

const API_KEY_SECRET = defineSecret("API_KEY");
const db = getFirestore();

const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const TARGET_STORAGE_BUCKET =
  process.env.GCLOUD_PROJECT + ".firebasestorage.app";
const PRODUCTS_COLLECTION = "products";

const PROMPT_FOR_DISCOUNT_EXTRACTION = `
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
      "active_until": string, // The date until which the discount is active. e.g. "2023-01-01"
      "discount_percent": number,
      "page_number": number
    },
    ...
  ]
}
</json example>

Requirements:
- Include only products with a clear, stated discount percentage
- The "discount_percent" field MUST be an integer. If you see a decimal, round it to the nearest whole number
- Use the EXACT price as shown in the PDF in its original currency for "price_before_discount_local"
- Use the correct currency code (EUR, BGN, USD, GBP, etc.) for "currency_local"
- Ensure all fields are filled where information is available
- Ensure product names are in the language of the PDF
- Round prices to 2 decimal places
`;

const extractDiscountsFromPdf = async (
  fileName: string,
  ai: GoogleGenAI
): Promise<DiscountDetails[]> => {
  const bucket = getStorage().bucket(TARGET_STORAGE_BUCKET);
  const tempFilePath = path.join(os.tmpdir(), path.basename(fileName));

  try {
    logger.info(`Downloading file from Storage: ${fileName}`);
    await bucket.file(fileName).download({ destination: tempFilePath });

    const uploadedFile = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType: "application/pdf" },
    });
    logger.info(`File uploaded to Gemini. URI: ${uploadedFile.uri}`);

    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          role: "user",
          parts: [
            { text: PROMPT_FOR_DISCOUNT_EXTRACTION },
            {
              fileData: {
                mimeType: "application/pdf",
                fileUri: uploadedFile.uri as string,
              },
            },
          ],
        },
      ],
      config: { responseMimeType: "application/json" },
    });

    const responseText = result.text;
    if (!responseText) {
      throw new Error(
        "Gemini API returned no text content for discount extraction."
      );
    }
    const { discounted_products: discountedProducts }: AnalysisResult =
      JSON.parse(responseText);
    return discountedProducts || [];
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
};

export const processPdfOnUpload = onObjectFinalized(
  {
    memory: "1GiB",
    timeoutSeconds: 300,
    secrets: [API_KEY_SECRET],
    region: "europe-west1",
  },
  async (event) => {
    const { name: filePath, contentType } = event.data;

    if (
      !filePath.startsWith("brochures/") ||
      !contentType?.startsWith("application/pdf")
    ) {
      logger.info("File is not a processable PDF brochure. Skipping.", {
        filePath,
      });
      return;
    }

    const pathParts = filePath.split("/");
    const fileName = pathParts[pathParts.length - 1];
    const storeInfo = fileName.replace(".pdf", "").split("_");
    const storeId = storeInfo[0];
    const country = storeInfo[1];
    const startDateStr = storeInfo[2];
    const endDateStr = storeInfo[3];

    const parseDate = (dateStr: string) => {
      const [day, month, year] = dateStr.split(".").map(Number);
      return new Date(year, month - 1, day);
    };

    const validFrom = parseDate(startDateStr);
    const validUntil = parseDate(endDateStr);

    logger.info("Processing PDF for discount extraction:", { filePath });

    try {
      const apiKey = API_KEY_SECRET.value();
      if (!apiKey) throw new Error("API_KEY secret is not configured");

      const ai = new GoogleGenAI({ apiKey });

      // Archive old products for this store in Firestore
      const oldProductsQuery = await db
        .collection(PRODUCTS_COLLECTION)
        .where("storeId", "==", storeId)
        .where("archivedAt", "==", null)
        .get();

      if (!oldProductsQuery.empty) {
        const archiveBatch = db.batch();
        oldProductsQuery.docs.forEach((doc) => {
          archiveBatch.update(doc.ref, {
            archivedAt: FieldValue.serverTimestamp(),
          });
        });
        await archiveBatch.commit();
        logger.info(
          `Archived ${oldProductsQuery.size} old products in Firestore for store: ${storeId}`
        );
      }

      const products = await extractDiscountsFromPdf(filePath, ai);
      if (products.length === 0) {
        logger.info("No discounted products found in the PDF.", { filePath });
        return;
      }
      logger.info(`Extracted ${products.length} discounted products.`);

      const firestoreBatch = db.batch();
      products.forEach((productDetails, index) => {
        const docId = `${event.id}_${index}`;
        const docRef = db.collection(PRODUCTS_COLLECTION).doc(docId);
        const newProduct: Product = {
          id: docId,
          sourceFileUri: `gs://${TARGET_STORAGE_BUCKET}/${filePath}`,
          storeId,
          country,
          valid_from: validFrom,
          valid_until: validUntil,
          isEmbedded: false,
          createdAt: FieldValue.serverTimestamp(),
          archivedAt: null,
          discount: productDetails,
        };
        firestoreBatch.set(docRef, newProduct);
      });

      await firestoreBatch.commit();
      logger.info(
        `Successfully stored ${products.length} new products in Firestore.`
      );
    } catch (error: any) {
      logger.error("FATAL: Error processing PDF for discount extraction:", {
        filePath,
        error: error.message,
      });
    }
  }
);
