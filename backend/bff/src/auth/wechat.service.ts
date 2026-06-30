import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppException } from "../common/app-exception";
import { AppEnv } from "../config/env";

interface WechatSession {
  openId: string;
  unionId?: string;
}

@Injectable()
export class WechatService {
  private readonly mockEnabled: boolean;

  constructor(private readonly config: ConfigService<AppEnv, true>) {
    this.mockEnabled = process.env.WECHAT_MOCK_ENABLED === "true";
  }

  async exchangeLoginCode(code: string): Promise<WechatSession> {
    if (this.mockEnabled) {
      return { openId: `mock_${code || "open-id"}` };
    }
    const query = new URLSearchParams({
      appid: this.config.get("wechatAppId", { infer: true }),
      secret: this.config.get("wechatAppSecret", { infer: true }),
      js_code: code,
      grant_type: "authorization_code",
    });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, {
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json()) as {
      openid?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!response.ok || body.errcode || !body.openid) {
      throw new AppException(
        "WECHAT_LOGIN_FAILED",
        "微信登录失败",
        HttpStatus.BAD_GATEWAY,
        { errcode: body.errcode, errmsg: body.errmsg },
      );
    }
    return { openId: body.openid, unionId: body.unionid };
  }

  async createUnlimitedCode(scene: string, page?: string): Promise<Buffer> {
    const tokenQuery = new URLSearchParams({
      grant_type: "client_credential",
      appid: this.config.get("wechatAppId", { infer: true }),
      secret: this.config.get("wechatAppSecret", { infer: true }),
    });
    const tokenResponse = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?${tokenQuery}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const tokenBody = (await tokenResponse.json()) as {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!tokenBody.access_token) {
      throw new AppException(
        "WECHAT_TOKEN_FAILED",
        "获取微信接口凭证失败",
        HttpStatus.BAD_GATEWAY,
        { errcode: tokenBody.errcode, errmsg: tokenBody.errmsg },
      );
    }

    const codeResponse = await fetch(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(tokenBody.access_token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scene, page, check_path: false }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const bytes = Buffer.from(await codeResponse.arrayBuffer());
    if (!codeResponse.ok || codeResponse.headers.get("content-type")?.includes("json")) {
      let details: unknown;
      try {
        details = JSON.parse(bytes.toString("utf8"));
      } catch {
        details = { status: codeResponse.status };
      }
      throw new AppException(
        "WECHAT_SOLAR_CODE_FAILED",
        "生成商家太阳码失败",
        HttpStatus.BAD_GATEWAY,
        details,
      );
    }
    return bytes;
  }
}
