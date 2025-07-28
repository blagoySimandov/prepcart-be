import { onObjectFinalized } from "firebase-functions/v2/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import { initializeAppIfNeeded } from "../util/firebase";
import { DiscountDetails, Product } from "../types";
import { AnalysisResult } from "./types";

initializeAppIfNeeded();

const API_KEY_SECRET = defineSecret("API_KEY");
const db = getFirestore();

const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const TARGET_STORAGE_BUCKET = process.env.GCLOUD_PROJECT + ".firebasestorage.app";
const PRODUCTS_COLLECTION = "products";
const MAX_PAGES_PER_CHUNK = 20;

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
      "discount_percent": number,
      "page_number": number,
      "requires_loyalty_card": boolean // true if the discount requires a loyalty card, membership, or special customer card
      "valid_from": string, // YYYY-MM-DD
      "valid_until": string // YYYY-MM-DD
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
- Ensure all fields are filled where information is available
- Ensure product names are in the language of the PDF
- Round prices to 2 decimal places
`;

const splitPdf = async (filePath: string, chunkSize: number): Promise<string[]> => {
  const pdfBytes = await fs.promises.readFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPages().length;
  const chunkPaths: string[] = [];
  const outputDir = path.dirname(filePath);

  for (let i = 0; i < totalPages; i += chunkSize) {
    const newPdf = await PDFDocument.create();
    const endPage = Math.min(i + chunkSize, totalPages);
    const pagesToCopy = Array.from({ length: endPage - i }, (_, k) => i + k);
    const copiedPages = await newPdf.copyPages(pdfDoc, pagesToCopy);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const chunkPath = path.join(outputDir, `chunk-${i / chunkSize + 1}.pdf`);
    const newPdfBytes = await newPdf.save();
    await fs.promises.writeFile(chunkPath, newPdfBytes);
    chunkPaths.push(chunkPath);
  }

  return chunkPaths;
};

const extractDiscountsFromPdf = async (
  filePaths: string[],
  ai: GoogleGenAI,
  chunkSize: number,
): Promise<DiscountDetails[]> => {
  let allDiscountedProducts: DiscountDetails[] = [];

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const startPage = i * chunkSize;

    try {
      const uploadedFile = await ai.files.upload({
        file: filePath,
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
      if (responseText) {
        const { discounted_products: discountedProducts }: AnalysisResult =
          JSON.parse(responseText);
        if (discountedProducts) {
          const adjustedProducts = discountedProducts.map((p) => ({
            ...p,
            page_number: p.page_number + startPage,
            valid_from: new Date(p.valid_from),
            valid_until: new Date(p.valid_until),
          }));
          allDiscountedProducts = allDiscountedProducts.concat(adjustedProducts);
        }
      }
    } catch (error) {
      logger.error("Error processing chunk:", {
        filePath,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  return allDiscountedProducts;
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

    if (!filePath.startsWith("brochures/") || !contentType?.startsWith("application/pdf")) {
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

    const startDate = parseDate(startDateStr);
    const endDate = new Date(parseDate(endDateStr).setHours(23, 59, 59, 999));

    logger.info("Processing PDF for discount extraction:", { filePath });

    const tempFilePath = path.join(os.tmpdir(), fileName);
    const bucket = getStorage().bucket(TARGET_STORAGE_BUCKET);

    try {
      await bucket.file(filePath).download({ destination: tempFilePath });

      const apiKey = API_KEY_SECRET.value();
      if (!apiKey) throw new Error("API_KEY secret is not configured");

      const ai = new GoogleGenAI({ apiKey });

      const chunkPaths = await splitPdf(tempFilePath, MAX_PAGES_PER_CHUNK);
      const products = await extractDiscountsFromPdf(chunkPaths, ai, MAX_PAGES_PER_CHUNK);

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
          startDate,
          endDate,
          isEmbedded: false,
          createdAt: FieldValue.serverTimestamp(),
          discount: productDetails,
        };
        firestoreBatch.set(docRef, newProduct);
      });

      await firestoreBatch.commit();
      logger.info(`Successfully stored ${products.length} new products in Firestore.`);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error("FATAL: Error processing PDF for discount extraction:", {
          filePath,
          error: error.message,
        });
      }
    } finally {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
  },
);
