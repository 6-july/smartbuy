import { ProductCandidate } from "./types";

export interface CandidatePriceOption {
  label: string;
  price: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getCandidatePriceOptions(candidate: ProductCandidate): CandidatePriceOption[] {
  if (!Array.isArray(candidate.options)) return [];
  return candidate.options.flatMap((group) => {
    if (!isRecord(group) || group.type !== "price" || !Array.isArray(group.options)) return [];
    return group.options.flatMap((option) => {
      if (!isRecord(option)) return [];
      const label = String(option.name || option.label || "").trim();
      const price = toFiniteNumber(option.price);
      return label && price !== null ? [{ label, price }] : [];
    });
  });
}
