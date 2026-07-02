import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { OptionalAuthGuard } from "../auth/optional-auth.guard";
import { AuthUser } from "../auth/auth.types";
import { ScanMerchantDto } from "./dto/scan-merchant.dto";
import { MerchantsService } from "./merchants.service";

@ApiTags("商家")
@Controller("merchant")
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Post("scan")
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: "解析商家太阳码并按登录态获取会话" })
  scan(@Body() dto: ScanMerchantDto, @Req() request: Request) {
    return this.merchants.scan(dto.scene, request.user?.id);
  }

  @Get(":merchantId/guide-info")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "获取商家导购页信息并按时间窗口获取会话" })
  guideInfo(@Param("merchantId") merchantId: string, @CurrentUser() user: AuthUser) {
    return this.merchants.guideInfo(merchantId, user.id);
  }
}
