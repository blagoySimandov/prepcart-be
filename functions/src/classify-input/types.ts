export interface ClassifyInputRequest {
  text: string;
}

export interface ClassifyInputResponse {
  product_name: string;
  quantity?: string;
  category?: string;
}
