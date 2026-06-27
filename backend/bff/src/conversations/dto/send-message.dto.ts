import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class SendMessageDto {
  @ApiProperty({ example: "200元以内有什么抹茶蛋糕？" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;

  @ApiProperty({ description: "客户端为每次发送生成的幂等 ID" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  clientMessageId!: string;
}
