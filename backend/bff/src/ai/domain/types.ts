export interface SearchIntent {
  queryText: string;
  keywords: string[];
  priceMin: number | null;
  priceMax: number | null;
  needRecommendation: boolean;
}

export interface ProductCandidate {
  id: string;
  title: string;
  category: string;
  description: string | null;
  displayPrice: number;
  minPrice: number;
  maxPrice: number;
  tags: unknown[];
  options: unknown[];
  aiText: string;
  score: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
