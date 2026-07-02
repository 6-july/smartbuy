import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ModelLatencyProbeDto {
  @ApiPropertyOptional({
    default: "你好，只回复“收到”两个字。",
    description: "裸调模型的用户消息，不带历史、商品池和工具。",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: 10,
    description: "重复请求次数，用于观察平均耗时。",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rounds = 1;
}
