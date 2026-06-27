import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AiModule } from "./ai/ai.module";
import { AuthModule } from "./auth/auth.module";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { loadEnv } from "./config/env";
import { ConversationsModule } from "./conversations/conversations.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { MerchantsModule } from "./merchants/merchants.module";
import { ProductsModule } from "./products/products.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: [loadEnv] }),
    DatabaseModule,
    AuthModule,
    MerchantsModule,
    ProductsModule,
    AiModule,
    ConversationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*splat}");
  }
}
