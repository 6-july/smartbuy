import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsUrl, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class WechatUserInfoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  avatarUrl?: string;
}

export class WechatLoginDto {
  @ApiProperty({ description: "wx.login 返回的一次性 code" })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({ type: WechatUserInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WechatUserInfoDto)
  userInfo?: WechatUserInfoDto;
}
