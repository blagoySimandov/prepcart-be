import { onProductEmbed } from "./discount-import/embed-product-handler";
import { enqueueProductForEmbedding } from "./discount-import/embed-products";
import { processPdfOnUpload } from "./discount-import/process-pdf";
import { kauflandCrawler } from "./kaufland-crawler";
import { catalogSearch } from "./catalog-search";
import { matchShoppingList } from "./discount-retrieval";

exports.processPdfOnUpload = processPdfOnUpload;
exports.enqueueProductForEmbedding = enqueueProductForEmbedding;
exports.onProductEmbed = onProductEmbed;
exports.matchShoppingList = matchShoppingList;
exports.kauflandCrawler = kauflandCrawler;
exports.catalogSearch = catalogSearch;
