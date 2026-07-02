import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class ProductQueryDto {
  @ApiProperty()
  @IsUUID()
  merchantId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ enum: ["on_sale", "off_sale"] })
  @IsOptional()
  @IsIn(["on_sale", "off_sale"])
  saleStatus?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class UpdateProductStatusDto {
  @ApiProperty({ enum: ["on_sale", "off_sale"] })
  @IsIn(["on_sale", "off_sale"])
  saleStatus!: "on_sale" | "off_sale";
}
