import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class ScanMerchantDto {
  @ApiProperty({ example: "m_abcd1234" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  scene!: string;
}
