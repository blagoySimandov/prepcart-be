import {
  MatchedProduct,
  ParsedQuantity,
  SavingsCalculationDetail,
} from "./types";

export const parseQuantity = (quantityString?: string): ParsedQuantity => {
  if (!quantityString) {
    return { isAmbiguous: false }; // Assume 1 piece if not specified
  }

  const s = quantityString.toLowerCase().trim();

  // Regular expression to match a number followed by an optional unit.
  const unambiguousPattern =
    /^\d+([.,]\d+)?\s*(kg|g|l|ml|pc|pcs|st|kom|br|бр)?s?$/;

  if (unambiguousPattern.test(s)) {
    return { isAmbiguous: false };
  }

  if (/^\d+([.,]\d+)?$/.test(s)) {
    return { isAmbiguous: false };
  }

  return { isAmbiguous: true };
};

export const calculateSavingsLocally = (
  matches: MatchedProduct[]
): {
  savings_by_currency: { [currency: string]: number };
  calculation_details: SavingsCalculationDetail[];
  ambiguous_matches: MatchedProduct[];
} => {
  const savingsByCurrency: { [currency: string]: number } = {};
  const calculationDetails: SavingsCalculationDetail[] = [];
  const ambiguousMatches: MatchedProduct[] = [];

  for (const match of matches) {
    const productQuantity = parseQuantity(match.matched_product.quantity);
    const savings =
      (match.matched_product.price_before_discount_local *
        match.matched_product.discount_percent) /
      100;

    if (productQuantity.isAmbiguous) {
      ambiguousMatches.push(match);
      continue;
    }

    const currency = match.matched_product.currency_local;

    if (!savingsByCurrency[currency]) {
      savingsByCurrency[currency] = 0;
    }

    savingsByCurrency[currency] += savings;

    calculationDetails.push({
      shopping_item: match.shopping_list_item,
      product_name: match.matched_product.product_name,
      savings: Math.round(savings * 100) / 100,
      currency,
      used_local_calculation: true,
    });
  }

  Object.keys(savingsByCurrency).forEach((currency) => {
    savingsByCurrency[currency] =
      Math.round(savingsByCurrency[currency] * 100) / 100;
  });

  return {
    savings_by_currency: savingsByCurrency,
    calculation_details: calculationDetails,
    ambiguous_matches: ambiguousMatches,
  };
};
