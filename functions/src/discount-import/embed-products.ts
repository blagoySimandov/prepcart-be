import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFunctions } from "firebase-admin/functions";
import { logger } from "firebase-functions/v2";
import { initializeAppIfNeeded } from "../util/firebase";
import { Product } from "./types";

initializeAppIfNeeded();

const PRODUCTS_COLLECTION = "products";

export const enqueueProductForEmbedding = onDocumentCreated(
  `${PRODUCTS_COLLECTION}/{productId}`,
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.info("No data associated with the event, skipping.");
      return;
    }

    const product = snapshot.data() as Product;
    logger.info("New product created, enqueueing for embedding.", {
      productId: product.id,
    });

    try {
      const queue = getFunctions().taskQueue("onProductEmbed");
      await queue.enqueue(product);
      logger.info("Successfully enqueued product for embedding.", {
        productId: product.id,
      });
    } catch (error) {
      logger.error("Error enqueueing product:", {
        productId: product.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);
