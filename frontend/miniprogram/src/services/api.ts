import Taro from "@tarojs/taro";
import type { ChatMessage, Conversation, GuideInfo, ProductCardData, UserProfile } from "@/types";
import { getToken } from "@/utils/auth";

const API_BASE = __API_BASE__;

export class ApiError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
  }
}

async function request<T>(options: Taro.request.Option): Promise<T> {
  if (!API_BASE && Taro.getEnv() !== Taro.ENV_TYPE.WEB) {
    throw new ApiError("未配置服务端地址 TARO_APP_API_BASE / TARO_APP_BASE_URL", "API_BASE_MISSING");
  }
  const token = getToken();
  const response = await Taro.request<Record<string, unknown>>({
    ...options,
    url: `${API_BASE}${options.url}`,
    header: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.header,
    },
  });
  if (response.statusCode >= 200 && response.statusCode < 300) return response.data as T;
  const data = response.data || {};
  throw new ApiError(
    String(data.message || "请求失败，请稍后再试"),
    data.code ? String(data.code) : undefined,
    response.statusCode,
  );
}

export async function wechatLogin(code: string) {
  return request<{ token: string; user: UserProfile }>({
    url: "/api/auth/wechat-login",
    method: "POST",
    data: { code },
  });
}

export async function listConversations(keyword = "") {
  return request<{ list: Conversation[] }>({
    url: `/api/conversations${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`,
    method: "GET",
  });
}

export async function scanMerchant(scene: string) {
  return request<{ merchantId: string; conversationId: string | null; needLogin: boolean }>({
    url: "/api/merchant/scan",
    method: "POST",
    data: { scene },
  });
}

export async function getGuideInfo(merchantId: string) {
  return request<GuideInfo>({ url: `/api/merchant/${merchantId}/guide-info`, method: "GET" });
}

export async function getMessages(conversationId: string) {
  return request<{ list: ChatMessage[] }>({ url: `/api/conversation/${conversationId}/messages`, method: "GET" });
}

export async function sendMessage(conversationId: string, content: string, clientMessageId: string) {
  return request<{ messageId: string; reply: string; products: ProductCardData[] }>({
    url: `/api/conversation/${conversationId}/message`,
    method: "POST",
    data: { content, clientMessageId },
  });
}
