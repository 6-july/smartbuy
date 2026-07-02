export interface ProductCandidate {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  displayPrice: number;
  minPrice: number;
  maxPrice: number;
  tags: unknown[];
  options: unknown[];
  optionsText: string;
  score: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
