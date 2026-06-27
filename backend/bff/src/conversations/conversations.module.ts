import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { ProductsModule } from "../products/products.module";
import { AdminConversationsController } from "./admin-conversations.controller";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

@Module({
  imports: [AuthModule, AiModule, ProductsModule],
  controllers: [ConversationsController, AdminConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
