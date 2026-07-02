import { getCandidatePriceOptions } from "../../domain";
import { RetrievedProduct } from "../../retrieval.service";
import { ProductSnapshot } from "../guide-state";

export function toProductSnapshot(item: RetrievedProduct): ProductSnapshot {
  const candidate = item.candidate;
  return {
    id: candidate.id,
    title: candidate.title,
    category: candidate.category || undefined,
    priceText: formatPriceText(candidate.minPrice, candidate.maxPrice),
    minPrice: candidate.minPrice,
    maxPrice: candidate.maxPrice,
    tags: candidate.tags
      .filter((tag): tag is string => typeof tag === "string")
      .slice(0, 8),
    summary: candidate.description || undefined,
    details: trimText(candidate.optionsText, 900),
    priceOptions: getCandidatePriceOptions(candidate),
  };
}

function formatPriceText(minPrice: number, maxPrice: number): string {
  if (minPrice === maxPrice) return `¥${formatPrice(minPrice)}`;
  return `¥${formatPrice(minPrice)}-¥${formatPrice(maxPrice)}`;
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function trimText(value: string, maxLength: number): string {
  const normalized = value.trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}
