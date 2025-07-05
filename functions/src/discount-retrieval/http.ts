import { ShoppingListRequest } from "./types";
import { Request } from "firebase-functions/v2/https";
import { Response } from "express";

export function isValidMethod(request: Request, response: Response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return false;
  }
  return true;
}

export function isValidRequestBody(request: Request, response: Response) {
  const requestData: ShoppingListRequest = request.body;
  if (
    !requestData.shopping_list ||
    !Array.isArray(requestData.shopping_list) ||
    requestData.shopping_list.length === 0
  ) {
    response.status(400).json({
      error: "shopping_list is required and must be a non-empty array",
    });
    return false;
  }
  return true;
}
