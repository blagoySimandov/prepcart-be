import { onProductEmbed } from "./discount-import/embed-product-handler";
import { enqueueProductForEmbedding } from "./discount-import/embed-products";
import { processPdfOnUpload } from "./discount-import/process-pdf";
import { reEmbedAllProducts } from "./discount-import/re-embed-products";
import { matchShoppingList } from "./discount-retrieval";

exports.enqueueProductForEmbedding = enqueueProductForEmbedding;
exports.onProductEmbed = onProductEmbed;
exports.reEmbedAllProducts = reEmbedAllProducts;
exports.processPdfOnUpload = processPdfOnUpload;
exports.matchShoppingList = matchShoppingList;
