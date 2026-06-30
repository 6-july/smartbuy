export interface AppEnv {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  adminServiceToken: string;
  wechatAppId: string;
  wechatAppSecret: string;
  aiChatApiUrl: string;
  aiChatApiKey: string;
  aiChatModel: string;
  embeddingApiUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  youzanProductPathTemplate: string;
  conversationReuseWindowMinutes: number;
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value.trim();
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadEnv(): AppEnv {
  return {
    port: Number(process.env.PORT || 3000),
    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
    jwtSecret: required("JWT_SECRET", process.env.JWT_SECRET),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    adminServiceToken: required("ADMIN_SERVICE_TOKEN", process.env.ADMIN_SERVICE_TOKEN),
    wechatAppId: required("WECHAT_PLATFORM_APP_ID", process.env.WECHAT_PLATFORM_APP_ID),
    wechatAppSecret: required(
      "WECHAT_PLATFORM_APP_SECRET",
      process.env.WECHAT_PLATFORM_APP_SECRET,
    ),
    aiChatApiUrl: process.env.AI_CHAT_API_URL || "",
    aiChatApiKey: process.env.AI_CHAT_API_KEY || "",
    aiChatModel: process.env.AI_CHAT_MODEL || "",
    embeddingApiUrl: process.env.EMBEDDING_API_URL || "",
    embeddingApiKey: process.env.EMBEDDING_API_KEY || "",
    embeddingModel: process.env.EMBEDDING_MODEL || "",
    youzanProductPathTemplate:
      process.env.PRODUCT_PATH_TEMPLATE_YOUZAN ||
      "/pages/goods/detail/index?alias={alias}",
    conversationReuseWindowMinutes: positiveNumber(
      process.env.CONVERSATION_REUSE_WINDOW_MINUTES,
      30,
    ),
  };
}
