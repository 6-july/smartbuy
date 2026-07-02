import { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export interface MerchantContext {
  id: string;
  name: string;
  description?: string | null;
  phone?: string | null;
  address?: string | null;
  industry?: string | null;
}

export interface ProductSnapshot {
  id: string;
  title: string;
  category?: string;
  priceText?: string;
  imageUrl?: string;
  tags?: string[];
  summary?: string;
  details?: string;
  minPrice?: number;
  maxPrice?: number;
  priceOptions?: Array<{
    label: string;
    price: number;
  }>;
}

export interface ProductContext {
  items: ProductSnapshot[];
  loadedAt?: string;
}

export interface CurrentProductContext {
  items: ProductSnapshot[];
  focusedId?: string;
}

export const GuideStateAnnotation = Annotation.Root({
  sessionId: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  merchantContext: Annotation<MerchantContext>({
    reducer: (_, right) => right,
  }),
  products: Annotation<ProductContext>({
    reducer: (left, right) => ({
      items: right?.items ?? left.items,
      loadedAt: right?.loadedAt ?? left.loadedAt,
    }),
    default: () => ({ items: [] }),
  }),
  currentProducts: Annotation<CurrentProductContext>({
    reducer: (left, right) => ({
      items: right?.items ?? left.items,
      focusedId: right?.focusedId ?? left.focusedId,
    }),
    default: () => ({ items: [] }),
  }),
});

export type GuideStateValue = typeof GuideStateAnnotation.State;
