import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard";
import { ImportProductsCsvDto, ImportProductsDto } from "./dto/import-products.dto";
import { ProductQueryDto, UpdateProductStatusDto } from "./dto/product-query.dto";
import { ProductsService } from "./products.service";

interface UploadedCsvFile {
  buffer: Buffer;
  originalname: string;
}

@ApiTags("内部管理-商品")
@ApiHeader({ name: "x-admin-token", required: true })
@UseGuards(AdminGuard)
@Controller("admin/products")
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post("import")
  @ApiOperation({ summary: "幂等导入标准化商品列表" })
  importProducts(@Body() dto: ImportProductsDto) {
    return this.products.importProducts(dto);
  }

  @Post("import-csv")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: "导入吾安有赞商品 CSV 并同步上下架" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["merchantId", "file"],
      properties: {
        merchantId: { type: "string", format: "uuid" },
        file: { type: "string", format: "binary" },
      },
    },
  })
  importProductsCsv(@Body() dto: ImportProductsCsvDto, @UploadedFile() file?: UploadedCsvFile) {
    return this.products.importProductsCsv(dto.merchantId, file?.buffer || "");
  }

  @Get()
  @ApiOperation({ summary: "分页查询商品" })
  list(@Query() query: ProductQueryDto) {
    return this.products.list(query);
  }

  @Get(":productId")
  @ApiOperation({ summary: "查询商品详情" })
  async detail(@Param("productId") productId: string) {
    return this.products.toProduct(await this.products.getById(productId));
  }

  @Patch(":productId/status")
  @ApiOperation({ summary: "修改商品销售状态" })
  updateStatus(@Param("productId") productId: string, @Body() dto: UpdateProductStatusDto) {
    return this.products.updateStatus(productId, dto.saleStatus);
  }
}
