import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { DatabaseService } from "../database/database.service";
import { AppEnv } from "../config/env";
import { AppException } from "../common/app-exception";
import { WechatLoginDto } from "./dto/wechat-login.dto";
import { WechatService } from "./wechat.service";

interface UserRow {
  id: string;
  open_id: string;
  nickname: string | null;
  avatar_url: string | null;
  status: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly wechat: WechatService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async login(dto: WechatLoginDto) {
    const session = await this.wechat.exchangeLoginCode(dto.code);
    const result = await this.database.query<UserRow>(
      `INSERT INTO users (
         wechat_app_id, open_id, union_id, nickname, avatar_url
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (wechat_app_id, open_id) DO UPDATE SET
         union_id = COALESCE(EXCLUDED.union_id, users.union_id),
         nickname = COALESCE(EXCLUDED.nickname, users.nickname),
         avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
       RETURNING id, open_id, nickname, avatar_url, status`,
      [
        this.config.get("wechatAppId", { infer: true }),
        session.openId,
        session.unionId || null,
        dto.userInfo?.nickname || null,
        dto.userInfo?.avatarUrl || null,
      ],
    );
    const user = result.rows[0];
    if (user.status !== "enabled") {
      throw new AppException("USER_DISABLED", "用户已停用", HttpStatus.FORBIDDEN);
    }
    const token = await this.jwt.signAsync(
      { sub: user.id, openId: user.open_id, status: user.status },
      { expiresIn: this.config.get("jwtExpiresIn", { infer: true }) as never },
    );
    return {
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
      },
    };
  }
}
