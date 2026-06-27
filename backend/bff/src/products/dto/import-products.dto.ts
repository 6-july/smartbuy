import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ProductImportItemDto {
  @ApiProperty({ example: "youzan" })
  @IsString()
  @IsNotEmpty()
  source!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceShopId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sourceProductId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  displayPrice!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice!: number;

  @ApiProperty({ type: [Object] })
  @IsArray()
  images!: unknown[];

  @ApiProperty()
  @IsInt()
  @Min(0)
  sales!: number;

  @ApiProperty()
  @IsBoolean()
  isRecommended!: boolean;

  @ApiProperty({ type: [Object] })
  @IsArray()
  options!: unknown[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  tags!: unknown[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  aiText!: string;
}

export class ImportProductsDto {
  @ApiProperty()
  @IsUUID()
  merchantId!: string;

  @ApiProperty({ type: [ProductImportItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImportItemDto)
  products!: ProductImportItemDto[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  deactivateMissing?: boolean;
}
