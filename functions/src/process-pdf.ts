import { onObjectFinalized } from "firebase-functions/v2/storage";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { AnalysisResult, PdfAnalysisResult } from "./types";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

initializeApp();

const API_KEY_SECRET = defineSecret("API_KEY");
const db = getFirestore();

const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const TARGET_STORAGE_BUCKET =
  process.env.GCLOUD_PROJECT + ".firebasestorage.app";
const PDF_ANALYSIS_COLLECTION = "pdfAnalysisResults";

const PROMPT_FOR_PDF_ANALYSIS = `
Task: Extract all products that have a discount from the provided content.
 Output Format: Return a JSON object with the following structure:
 <json example>
 {
 "discounted_products": [
 {
 "product_name": "string",               // Detailed product name in English
 "price_before_discount_local": number,     // Price before discount in local currency
 "currency_local": "string",                // Local currency (e.g. "BGN", "HUF", "RON")
 "price_before_discount_eur": number,       // Price before discount converted to Euro
 "discount_percent": number,                // Discount amount as a number (e.g. 25 for 25%)
 "page_number": number                      // Page number where the product appears
 },
 ...
 ]
 }
 </json example>
 Requirements:
 
 Include only products that have a clear discount.
 
 Ensure all fields are filled where information is available.
 
 Translate product names into English with as much detail as possible.
`;

const processPdf = async (fileName: string, ai: GoogleGenAI) => {
  const bucket = getStorage().bucket(TARGET_STORAGE_BUCKET);
  const tempFilePath = path.join(os.tmpdir(), path.basename(fileName));

  try {
    logger.info(`Downloading file from Storage: ${fileName}`);
    await bucket.file(fileName).download({ destination: tempFilePath });

    logger.info(`Uploading file to Gemini Files API: ${tempFilePath}`);
    const uploadedFile = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType: "application/pdf" },
    });

    logger.info(`File uploaded to Gemini. URI: ${uploadedFile.uri}`);

    if (!uploadedFile.uri) {
      throw new Error("Failed to get file URI from uploaded file");
    }

    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: PROMPT_FOR_PDF_ANALYSIS,
            },
            {
              fileData: {
                mimeType: "application/pdf",
                fileUri: uploadedFile.uri as string,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      logger.info(`Cleaned up temporary file: ${tempFilePath}`);
    }
    // NOTE: The uploaded file is auto-deleted after 48 hours
    try {
      if (uploadedFile.name) {
        await ai.files.delete({ name: uploadedFile.name });
        logger.info(
          `Cleaned up uploaded file from Gemini: ${uploadedFile.name}`,
        );
      }
    } catch (deleteError) {
      logger.warn(`Could not delete uploaded file: ${deleteError}`);
    }

    return result;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      logger.info(`Cleaned up temporary file after error: ${tempFilePath}`);
    }
    throw error;
  }
};
const filePathToURI = (filePath: string) => {
  const bucket = getStorage().bucket(TARGET_STORAGE_BUCKET);
  return bucket.file(filePath).toString();
};

export const processPdfOnUpload = onObjectFinalized(
  {
    memory: "512MiB",
    timeoutSeconds: 240,
    secrets: [API_KEY_SECRET],
    region: "europe-west1",
  },
  async (event) => {
    const object = event.data;
    const fileBucket = object.bucket;
    const filePath = object.name;

    if (!filePath.startsWith("brochures/")) {
      logger.info("File is not under the 'brochures/' folder. Skipping.", {
        filePath,
      });
      return;
    }

    const contentType = object.contentType;
    if (!contentType || !contentType.startsWith("application/pdf")) {
      logger.info("This is not a PDF file.", { filePath, contentType });
      return;
    }

    logger.info("Processing PDF file:", { filePath });

    try {
      const apiKey = API_KEY_SECRET.value();
      if (!apiKey) {
        throw new Error("API_KEY secret is not configured");
      }

      const ai = new GoogleGenAI({ apiKey });

      const result = await processPdf(filePath, ai);
      logger.info("Received response from Gemini API.");

      const geminiResponseText = result.text;

      if (!geminiResponseText) {
        logger.warn("Gemini API returned no text content for:", { filePath });

        const noTextResult: PdfAnalysisResult = {
          fileUri: filePathToURI(filePath),
          bucket: fileBucket,
          status: "completed_no_text_response",
          timestamp: FieldValue.serverTimestamp(),
          errorMessage: "Gemini API returned no text content.",
        };

        await db.collection(PDF_ANALYSIS_COLLECTION).add(noTextResult);
        logger.info("Stored no-text response indicator in Firestore for:", {
          filePath,
        });
        return;
      }
      let structuredData: AnalysisResult;
      try {
        structuredData = JSON.parse(geminiResponseText);
        logger.info("Successfully extracted text. Storing in Firestore...");
      } catch (error: any) {
        logger.error("Error parsing extracted text:", {
          filePath,
          error: error.message,
        });
        const errorResult: PdfAnalysisResult = {
          fileUri: filePathToURI(filePath),
          bucket: fileBucket,
          status: "error",
          errorMessage: "Error parsing extracted text.",
          errorDetails: error.toString(),
          timestamp: FieldValue.serverTimestamp(),
        };
        await db.collection(PDF_ANALYSIS_COLLECTION).add(errorResult);
        logger.info("Error details stored in Firestore for:", { filePath });
        return;
      }
      logger.info("Successfully extracted text. Storing in Firestore...");

      const successResult: PdfAnalysisResult = {
        fileUri: filePathToURI(filePath),
        bucket: fileBucket,
        status: "completed",
        extractedData: structuredData,
        timestamp: FieldValue.serverTimestamp(),
      };

      await db.collection(PDF_ANALYSIS_COLLECTION).add(successResult);
      logger.info("PDF analysis results stored in Firestore for:", {
        filePath,
      });
    } catch (error: any) {
      logger.error("Error processing PDF file:", {
        filePath,
        error: error.message,
      });

      try {
        const errorResult: PdfAnalysisResult = {
          fileUri: filePathToURI(filePath),
          bucket: fileBucket,
          status: "error",
          errorMessage: error.message,
          errorDetails: error.toString(),
          timestamp: FieldValue.serverTimestamp(),
        };

        await db.collection(PDF_ANALYSIS_COLLECTION).add(errorResult);
        logger.info("Error details stored in Firestore for:", { filePath });
      } catch (firestoreError: any) {
        logger.error(
          "FATAL ERROR: Could not store error details in Firestore for:",
          {
            filePath,
            firestoreError: firestoreError.message,
          },
        );
      }
    }
  },
);
