import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MerchantsModule } from "../merchants/merchants.module";
import { AdminProductsController } from "./admin-products.controller";
import { ProductLinkService } from "./product-link.service";
import { ProductsService } from "./products.service";

@Module({
  imports: [AuthModule, MerchantsModule],
  controllers: [AdminProductsController],
  providers: [ProductsService, ProductLinkService],
  exports: [ProductsService, ProductLinkService],
})
export class ProductsModule {}
