import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppEnv } from "../config/env";

@Injectable()
export class ProductLinkService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  build(source: string, alias: string | null): {
    miniProgramPath: string | null;
    miniProgramParams: Record<string, string>;
  } {
    if (source !== "youzan" || !alias) {
      return { miniProgramPath: null, miniProgramParams: {} };
    }
    const template = this.config.get("youzanProductPathTemplate", { infer: true });
    return {
      miniProgramPath: template.replace("{alias}", encodeURIComponent(alias)),
      miniProgramParams: { alias },
    };
  }
}
