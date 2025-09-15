import { GoogleGenAI } from "@google/genai";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import { PRODUCTS_COLLECTION } from "../constants";
import { BrochureRecord, DiscountDetails, Product } from "../types";
import { initializeAppIfNeeded } from "../util/firebase";
import { notifyError } from "../util/error-notification";
import {
  API_KEY_SECRET,
  BROCHURES_COLLECTION,
  MAX_PAGES_PER_CHUNK,
  MODEL_NAME,
  PROMPT_FOR_DISCOUNT_EXTRACTION,
  TARGET_STORAGE_BUCKET,
} from "./constants";
import { AnalysisResult } from "./types";

initializeAppIfNeeded();

const db = getFirestore();

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

const getBrochureRecord = async (fileName: string): Promise<BrochureRecord | null> => {
  const brochureQuery = await db
    .collection(BROCHURES_COLLECTION)
    .where("filename", "==", fileName)
    .limit(1)
    .get();

  if (brochureQuery.empty) {
    logger.error("No brochure record found for filename", { fileName });
    return null;
  }

  const brochureDoc = brochureQuery.docs[0];
  const brochureData = brochureDoc.data() as BrochureRecord;

  if (!brochureData.cityIds || brochureData.cityIds.length === 0) {
    logger.error("Missing required cityIds in brochure record", {
      brochureId: brochureData.brochureId,
      fileName,
    });
    return null;
  }

  return brochureData;
};

const updateBrochureRecord = async (
  fileName: string,
  updates: {
    hasEncounteredError: boolean;
    lastRunId: string;
    numberOfItemsCollected?: number;
  }
): Promise<void> => {
  const brochureQuery = await db
    .collection(BROCHURES_COLLECTION)
    .where("filename", "==", fileName)
    .limit(1)
    .get();

  if (!brochureQuery.empty) {
    const brochureDoc = brochureQuery.docs[0];
    await brochureDoc.ref.update(updates);
  }
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
      logger.info("File uploaded to Gemini for analysis", {
        uri: uploadedFile.uri,
        chunkIndex: i + 1,
        totalChunks: filePaths.length,
      });

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

  logger.info("Completed discount extraction from all PDF chunks", {
    totalDiscountedProducts: allDiscountedProducts.length,
    chunksProcessed: filePaths.length,
  });
  return allDiscountedProducts;
};

const processPdfFile = async (filePath: string, eventId?: string): Promise<void> => {
  const pathParts = filePath.split("/");
  const fileName = pathParts[pathParts.length - 1];

  const brochureRecord = await getBrochureRecord(fileName);
  if (!brochureRecord) {
    throw new Error(`No brochure record found for file: ${fileName}`);
  }

  const { storeId, country, cityIds, brochureId } = brochureRecord;

  logger.info("Starting PDF processing for brochure", {
    brochureId,
    fileName,
    storeId,
    country,
    cities: cityIds.join(", "),
    filePath,
  });

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
      logger.info("No discounted products found in brochure", {
        brochureId,
        fileName,
        filePath,
      });

      // Update brochure record with success status but 0 items
      const baseId = eventId || `retry_${Date.now()}`;
      await updateBrochureRecord(fileName, {
        hasEncounteredError: false,
        lastRunId: baseId,
        numberOfItemsCollected: 0,
      });
      return;
    }

    logger.info("Successfully extracted discounted products from brochure", {
      brochureId,
      fileName,
      productCount: products.length,
    });

    const firestoreBatch = db.batch();
    let productIndex = 0;

    // Use eventId if provided, otherwise generate a timestamp-based ID
    const baseId = eventId || `retry_${Date.now()}`;

    // Create products for each city
    cityIds.forEach(() => {
      products.forEach((productDetails) => {
        const docId = `${baseId}_${productIndex}`;
        const docRef = db.collection(PRODUCTS_COLLECTION).doc(docId);
        const newProduct: Product = {
          id: docId,
          sourceFileUri: `gs://${TARGET_STORAGE_BUCKET}/${filePath}`,
          storeId,
          country,
          cityIds,
          isEmbedded: false,
          createdAt: FieldValue.serverTimestamp(),
          discount: productDetails,
        };
        firestoreBatch.set(docRef, newProduct);
        productIndex++;
      });
    });

    await firestoreBatch.commit();
    const totalProducts = products.length * cityIds.length;
    logger.info("Successfully stored products in Firestore for brochure", {
      brochureId,
      fileName,
      totalProducts,
      cities: cityIds.join(", "),
      storeId,
      country,
    });

    // Update brochure record with success status
    await updateBrochureRecord(fileName, {
      hasEncounteredError: false,
      lastRunId: baseId,
      numberOfItemsCollected: totalProducts,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("FATAL: Error processing PDF for discount extraction", {
      brochureId,
      fileName,
      filePath,
      error: errorMessage,
    });

    // Update brochure record with error status
    const baseId = eventId || `retry_${Date.now()}`;
    await updateBrochureRecord(fileName, {
      hasEncounteredError: true,
      lastRunId: baseId,
      numberOfItemsCollected: 0,
    });

    await notifyError(`PDF processing failed for brochure ${brochureId}`, {
      brochureId,
      fileName,
      filePath,
      storeId,
      country,
      cities: cityIds.join(", "),
      error: errorMessage,
    });

    throw error;
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

    if (!filePath.startsWith("brochures/") || !contentType?.startsWith("application/pdf")) {
      logger.info("File is not a processable PDF brochure, skipping", {
        filePath,
        contentType,
      });
      return;
    }

    try {
      await processPdfFile(filePath, event.id);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error("FATAL: Error processing PDF for discount extraction", {
          filePath,
          eventId: event.id,
          error: error.message,
        });

        await notifyError("PDF upload processing failed", {
          filePath,
          eventId: event.id,
          error: error.message,
          source: "processPdfOnUpload",
        });
      }
    }
  },
);

export const retryProcessPdf = onCall(
  {
    memory: "1GiB",
    timeoutSeconds: 300,
    secrets: [API_KEY_SECRET],
    region: "europe-west1",
  },
  async (request) => {
    const { pdfPath } = request.data;

    if (!pdfPath) {
      throw new Error("pdfPath is required");
    }

    if (!pdfPath.startsWith("brochures/") || !pdfPath.endsWith(".pdf")) {
      throw new Error("Invalid PDF path. Must start with 'brochures/' and end with '.pdf'");
    }

    logger.info("Retrying PDF processing", { pdfPath });

    try {
      await processPdfFile(pdfPath);
      return { success: true, message: "PDF processed successfully" };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error retrying PDF processing", {
        pdfPath,
        error: errorMessage,
      });

      await notifyError("PDF retry processing failed", {
        pdfPath,
        error: errorMessage,
        source: "retryProcessPdf",
      });

      throw new Error(`Failed to process PDF: ${errorMessage}`);
    }
  },
);
