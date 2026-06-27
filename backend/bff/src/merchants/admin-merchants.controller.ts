import {
  Body,
  Controller,
  Header,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard";
import { WechatService } from "../auth/wechat.service";
import { CreateMerchantDto } from "./dto/create-merchant.dto";
import { MerchantsService } from "./merchants.service";

@ApiTags("内部管理-商家")
@ApiHeader({ name: "x-admin-token", required: true })
@UseGuards(AdminGuard)
@Controller("admin/merchants")
export class AdminMerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly wechat: WechatService,
  ) {}

  @Post()
  @ApiOperation({ summary: "创建商家" })
  create(@Body() dto: CreateMerchantDto) {
    return this.merchants.create(dto);
  }

  @Post(":merchantId/solar-code")
  @ApiProduces("image/png")
  @Header("content-type", "image/png")
  @ApiOperation({ summary: "生成商家太阳码 PNG" })
  async solarCode(@Param("merchantId") merchantId: string): Promise<StreamableFile> {
    const merchant = await this.merchants.findEnabledById(merchantId);
    return new StreamableFile(await this.wechat.createUnlimitedCode(merchant.scene_code));
  }
}
