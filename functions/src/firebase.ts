import { initializeApp, getApps } from "firebase-admin/app";

/**
 * Initializes the Firebase Admin SDK, preventing re-initialization errors.
 */
export const initializeAppIfNeeded = () => {
  if (getApps().length === 0) {
    initializeApp();
    console.log("Firebase App Initialized");
  }
};
