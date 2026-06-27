import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminMerchantsController } from "./admin-merchants.controller";
import { MerchantsController } from "./merchants.controller";
import { MerchantsService } from "./merchants.service";

@Module({
  imports: [AuthModule],
  controllers: [MerchantsController, AdminMerchantsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
