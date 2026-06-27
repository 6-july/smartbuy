import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MerchantsModule } from "../merchants/merchants.module";
import { AdminProductsController } from "./admin-products.controller";
import { EmbeddingService } from "./embedding.service";
import { ProductLinkService } from "./product-link.service";
import { ProductsService } from "./products.service";

@Module({
  imports: [AuthModule, MerchantsModule],
  controllers: [AdminProductsController],
  providers: [ProductsService, EmbeddingService, ProductLinkService],
  exports: [ProductsService, EmbeddingService, ProductLinkService],
})
export class ProductsModule {}
