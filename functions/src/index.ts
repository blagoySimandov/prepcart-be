import { scrapeUrl } from "./scrape";
import { onProductEmbed } from "./discount-import/embed-product-handler";
import { enqueueProductForEmbedding } from "./discount-import/embed-products";
import { processPdfOnUpload } from "./discount-import/process-pdf";
import { matchShoppingList } from "./discount-retrieval/shopping-list-matcher";
import { autocomplete } from "./autocomplete";
import { classifyInput } from "./classify-input";

exports.processPdfOnUpload = processPdfOnUpload;
exports.scrapeUrl = scrapeUrl;
exports.enqueueProductForEmbedding = enqueueProductForEmbedding;
exports.onProductEmbed = onProductEmbed;
exports.matchShoppingList = matchShoppingList;
exports.autocomplete = autocomplete;
exports.classifyInput = classifyInput;
