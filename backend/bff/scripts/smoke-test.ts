import pg from "pg";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000/api";
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
const adminToken = requiredEnv("ADMIN_SERVICE_TOKEN");
const databaseUrl = requiredEnv("DATABASE_URL");

const suffix = Date.now().toString(36);
const database = new pg.Client({ connectionString: databaseUrl });
let merchantId: string | null = null;
let userId: string | null = null;

async function jsonRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function run(): Promise<void> {
  await database.connect();
  try {
    const merchant = await jsonRequest("/admin/merchants", {
      method: "POST",
      headers: { "x-admin-token": adminToken },
      body: JSON.stringify({
        name: `smoke-merchant-${suffix}`,
        miniProgramAppId: "wx-smoke-merchant",
        recommendQuestions: ["有什么测试蛋糕？"],
      }),
    });
    merchantId = merchant.id;

    const imported = await jsonRequest("/admin/products/import", {
      method: "POST",
      headers: { "x-admin-token": adminToken },
      body: JSON.stringify({
        merchantId,
        products: [
          {
            source: "youzan",
            sourceShopId: "smoke-shop",
            sourceProductId: `smoke-product-${suffix}`,
            alias: `smoke-alias-${suffix}`,
            category: "蛋糕",
            title: "测试抹茶蛋糕",
            description: "",
            displayPrice: 99,
            minPrice: 99,
            maxPrice: 99,
            images: [{ url: "https://example.com/smoke.jpg", size: "100*100" }],
            sales: 1,
            isRecommended: true,
            options: [],
            tags: ["抹茶"],
            aiText: "测试抹茶蛋糕，分类：蛋糕。价格99元。",
          },
        ],
      }),
    });
    if (imported.created !== 1) throw new Error("Expected one imported product");

    const login = await jsonRequest("/auth/wechat-login", {
      method: "POST",
      body: JSON.stringify({ code: `smoke-login-${suffix}` }),
    });
    userId = login.user.id;
    const auth = { authorization: `Bearer ${login.token}` };

    const scan = await jsonRequest("/merchant/scan", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ scene: merchant.sceneCode }),
    });
    if (!scan.conversationId || scan.needLogin) throw new Error("Authenticated scan failed");

    const guide = await jsonRequest(`/merchant/${merchantId}/guide-info`, { headers: auth });
    if (guide.conversationId !== scan.conversationId) {
      throw new Error("Conversation was not reused");
    }

    const reply = await jsonRequest(`/conversation/${scan.conversationId}/message`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        content: "100元以内的抹茶蛋糕推荐一下",
        clientMessageId: `smoke-message-${suffix}`,
      }),
    });
    if (reply.products.length !== 1) throw new Error("Expected one product card");

    const solarCode = await fetch(`${baseUrl}/admin/merchants/${merchantId}/solar-code`, {
      method: "POST",
      headers: { "x-admin-token": adminToken },
    });
    if (!solarCode.ok || !(solarCode.headers.get("content-type") || "").includes("image/png")) {
      throw new Error("Solar code endpoint failed");
    }

    process.stdout.write(
      `${JSON.stringify({
        merchantId,
        conversationId: scan.conversationId,
        productCards: reply.products.length,
        solarCode: "ok",
      })}\n`,
    );
  } finally {
    if (merchantId || userId) {
      await database.query("BEGIN");
      try {
        if (merchantId) {
          await database.query("DELETE FROM messages WHERE merchant_id = $1", [merchantId]);
          await database.query("DELETE FROM conversations WHERE merchant_id = $1", [merchantId]);
          await database.query("DELETE FROM products WHERE merchant_id = $1", [merchantId]);
          await database.query("DELETE FROM merchants WHERE id = $1", [merchantId]);
        }
        if (userId) await database.query("DELETE FROM users WHERE id = $1", [userId]);
        await database.query("COMMIT");
      } catch (error) {
        await database.query("ROLLBACK");
        throw error;
      }
    }
    await database.end();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
