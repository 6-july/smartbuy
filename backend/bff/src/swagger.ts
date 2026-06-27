import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("SmartBuy 服务端 API")
    .setDescription("智能导购小程序 MVP 服务端接口")
    .setVersion("1.0.0")
    .addBearerAuth()
    .addApiKey({ type: "apiKey", name: "x-admin-token", in: "header" }, "adminToken")
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
}
