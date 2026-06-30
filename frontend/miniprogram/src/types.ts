export interface UserProfile {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
}

export interface Conversation {
  conversationId: string;
  merchantId: string;
  merchantName: string;
  merchantLogo: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
}

export interface Merchant {
  id: string;
  name: string;
  logo: string | null;
  description: string | null;
  bannerImage: string | null;
  miniProgramAppId: string;
  status: string;
}

export interface SpecValue {
  label: string;
  price: number | null;
}

export interface ProductSpec {
  name: string;
  values: SpecValue[];
}

export interface ProductCardData {
  productId: string;
  name: string;
  tags: string[];
  description: string | null;
  price: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  imageUrl: string | null;
  images: string[];
  specs: ProductSpec[];
  miniProgramAppId: string;
  miniProgramPath: string | null;
  miniProgramParams: Record<string, string> | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  messageType: "text" | "product_card";
  products: ProductCardData[];
  createdAt: string;
  pending?: boolean;
  isCurrentSession?: boolean;
}

export interface GuideInfo {
  merchant: Merchant;
  recommendQuestions: string[];
  conversationId: string;
}
