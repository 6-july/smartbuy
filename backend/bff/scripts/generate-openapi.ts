import "reflect-metadata";
import fs from "node:fs/promises";
import path from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { createOpenApiDocument } from "../src/swagger";

async function generate(): Promise<void> {
  process.env.DATABASE_URL ||= "postgresql://docs:docs@127.0.0.1:5432/docs";
  process.env.JWT_SECRET ||= "docs-only-secret";
  process.env.ADMIN_SERVICE_TOKEN ||= "docs-only-admin-token";
  process.env.WECHAT_PLATFORM_APP_ID ||= "wx-docs-only";
  process.env.WECHAT_PLATFORM_APP_SECRET ||= "docs-only-secret";

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  const document = createOpenApiDocument(app);
  const output = path.resolve(process.cwd(), "../../docs/api/openapi.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  process.stdout.write(`${output}\n`);
}

generate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
