import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { logger } from "firebase-functions/v2";
import { initializeAppIfNeeded } from "../util/firebase";
import { Product } from "./types";
import { PRODUCTS_COLLECTION } from "../constants";

initializeAppIfNeeded();

const db = getFirestore();

export const reEmbedAllProducts = onRequest(
  {
    timeoutSeconds: 300,
    memory: "1GiB",
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== "POST") {
        response.status(405).json({ error: "Method not allowed" });
        return;
      }

      logger.info("Starting re-embedding dispatcher for all products");

      const query = db.collection(PRODUCTS_COLLECTION);

      // Optional: Only re-embed products that haven't been embedded recently
      // You can uncomment this to avoid re-embedding products updated in the last 24 hours
      // const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // query = query.where("lastEmbeddingUpdate", "<", oneDayAgo);

      const productsSnapshot = await query.get();

      if (productsSnapshot.empty) {
        logger.info("No products found to re-embed");
        response.json({
          success: true,
          message: "No products found to re-embed",
          totalDispatched: 0,
        });
        return;
      }

      const totalProducts = productsSnapshot.size;
      logger.info(`Found ${totalProducts} products to re-embed`);

      const functions = getFunctions();

      let dispatchedCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      const batchSize = 25;
      const batches: Product[][] = [];

      let currentBatch: Product[] = [];
      productsSnapshot.forEach((doc) => {
        const product = { id: doc.id, ...doc.data() } as Product;
        currentBatch.push(product);

        if (currentBatch.length === batchSize) {
          batches.push(currentBatch);
          currentBatch = [];
        }
      });

      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      logger.info(`Dispatching ${batches.length} batches of up to ${batchSize} products each`);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        logger.info(`Dispatching batch ${batchIndex + 1}/${batches.length}`);

        const dispatchPromises = batch.map(async (product) => {
          try {
            const delaySeconds = Math.floor(Math.random() * 30);
            await functions.taskQueue("onProductEmbed").enqueue(product, {
              scheduleDelaySeconds: delaySeconds,
            });

            logger.info(
              `Dispatched product for re-embedding: ${product.id} (delay: ${delaySeconds}s)`
            );
            return { success: true };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error(`Error dispatching product ${product.id}:`, { error: errorMessage });
            return { success: false, error: errorMessage };
          }
        });

        const batchResults = await Promise.all(dispatchPromises);

        batchResults.forEach((result) => {
          if (result.success) {
            dispatchedCount++;
          } else {
            errorCount++;
            errors.push(result.error || "Unknown error");
          }
        });

        logger.info(
          `Batch ${
            batchIndex + 1
          } dispatched. Progress: ${dispatchedCount}/${totalProducts} products dispatched`
        );

        if (batchIndex < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      const summary = {
        success: true,
        totalProducts,
        dispatchedCount,
        errorCount,
        errors: errors.slice(0, 10),
        message: `Successfully dispatched ${dispatchedCount} products for re-embedding. Check the onProductEmbed function logs for individual embedding results.`,
      };

      logger.info("Re-embedding dispatch completed", summary);
      response.json(summary);
    } catch (error) {
      logger.error("Fatal error in re-embedding dispatcher:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      response.status(500).json({
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);
