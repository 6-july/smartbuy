import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

export interface MerchantContext {
  id: string;
  name: string;
  description?: string | null;
  phone?: string | null;
  industry?: string | null;
}

export interface ProductSnapshot {
  id: string;
  title: string;
  priceText?: string;
  imageUrl?: string;
  tags?: string[];
  summary?: string;
}

export interface ProductContext {
  shown: ProductSnapshot[];
  focusedId?: string;
}

export const GuideStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  merchantContext: Annotation<MerchantContext>({
    reducer: (_, right) => right,
  }),
  products: Annotation<ProductContext>({
    reducer: (left, right) => ({
      shown: right.shown ?? left.shown,
      focusedId: right.focusedId ?? left.focusedId,
    }),
    default: () => ({ shown: [] }),
  }),
});

export type GuideStateValue = typeof GuideStateAnnotation.State;
