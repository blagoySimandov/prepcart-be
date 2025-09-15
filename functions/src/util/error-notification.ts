import { logger } from "firebase-functions/v2";

export const notifyError = async (
  errorMessage: string,
  context?: Record<string, unknown>,
): Promise<void> => {
  const webhookUrl = "https://n8n.prepcart.it.com/webhook/ad1fe76e-95e1-4fa5-a7ea-0066dcad8dc5";

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: errorMessage,
        context: context || {},
        timestamp: new Date().toISOString(),
      }),
    });

    if (response.ok) {
      logger.info("Error notification sent successfully", { errorMessage });
    } else {
      logger.error("Failed to send error notification", {
        httpStatus: response.status,
        errorMessage,
      });
    }
  } catch (notificationError) {
    logger.error("Error sending notification", {
      notificationError:
        notificationError instanceof Error ? notificationError.message : "Unknown error",
      originalError: errorMessage,
    });
  }
};

