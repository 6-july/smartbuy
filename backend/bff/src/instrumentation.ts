import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
const langfuseBaseUrl =
  process.env.LANGFUSE_BASE_URL?.trim() || "https://cloud.langfuse.com";
const langfuseExportMode =
  process.env.LANGFUSE_EXPORT_MODE === "immediate" ? "immediate" : "batched";

let sdk: NodeSDK | null = null;

if (langfusePublicKey && langfuseSecretKey) {
  try {
    const processor = new LangfuseSpanProcessor({
      publicKey: langfusePublicKey,
      secretKey: langfuseSecretKey,
      baseUrl: langfuseBaseUrl,
      environment: process.env.NODE_ENV || "development",
      exportMode: langfuseExportMode,
      mediaUploadEnabled: false,
      mask: ({ data }) => maskSensitiveData(data),
    });
    sdk = new NodeSDK({ spanProcessors: [processor] });
    sdk.start();
  } catch (error) {
    console.warn("[Langfuse] tracing disabled:", error);
  }
}

function maskSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (typeof value === "string") return maskSensitiveString(value);
  if (Array.isArray(value)) return value.map((item) => maskSensitiveData(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? "[REDACTED]" : maskSensitiveData(item, depth + 1),
    ]),
  );
}

function isSensitiveKey(key: string): boolean {
  return /authorization|password|secret|token|apikey|api_key|openid|sessionkey|session_key/i.test(key);
}

function maskSensitiveString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|pk|ark)_[A-Za-z0-9._-]{12,}\b/g, "[REDACTED_KEY]");
}
