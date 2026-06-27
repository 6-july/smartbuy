import { randomBytes } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../common/app-exception";
import { DatabaseService } from "../database/database.service";
import { CreateMerchantDto } from "./dto/create-merchant.dto";

export interface MerchantRow {
  id: string;
  name: string;
  logo: string | null;
  description: string | null;
  banner_image: string | null;
  mini_program_app_id: string;
  scene_code: string;
  recommend_questions: string[];
  status: string;
}

@Injectable()
export class MerchantsService {
  constructor(private readonly database: DatabaseService) {}

  async create(dto: CreateMerchantDto) {
    const sceneCode = `m_${randomBytes(10).toString("base64url")}`;
    const result = await this.database.query<MerchantRow>(
      `INSERT INTO merchants (
         name, logo, description, banner_image, mini_program_app_id,
         scene_code, recommend_questions
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [
        dto.name,
        dto.logo || null,
        dto.description || null,
        dto.bannerImage || null,
        dto.miniProgramAppId,
        sceneCode,
        JSON.stringify(dto.recommendQuestions || []),
      ],
    );
    return this.mapMerchant(result.rows[0]);
  }

  async scan(scene: string, userId?: string) {
    const merchant = await this.findByScene(scene);
    if (!userId) {
      return { merchantId: merchant.id, conversationId: null, needLogin: true };
    }
    const conversationId = await this.getOrCreateConversation(userId, merchant.id);
    return { merchantId: merchant.id, conversationId, needLogin: false };
  }

  async guideInfo(merchantId: string, userId: string) {
    const merchant = await this.findEnabledById(merchantId);
    const conversationId = await this.getOrCreateConversation(userId, merchant.id);
    return {
      merchant: this.mapMerchant(merchant),
      recommendQuestions: merchant.recommend_questions,
      conversationId,
    };
  }

  async findEnabledById(id: string): Promise<MerchantRow> {
    const result = await this.database.query<MerchantRow>(
      `SELECT * FROM merchants WHERE id = $1 AND status <> 'deleted'`,
      [id],
    );
    const merchant = result.rows[0];
    if (!merchant) {
      throw new AppException("MERCHANT_NOT_FOUND", "未找到对应商家", HttpStatus.NOT_FOUND);
    }
    if (merchant.status !== "enabled") {
      throw new AppException(
        "MERCHANT_DISABLED",
        "该商家导购服务暂不可用",
        HttpStatus.CONFLICT,
      );
    }
    return merchant;
  }

  private async findByScene(scene: string): Promise<MerchantRow> {
    const result = await this.database.query<MerchantRow>(
      `SELECT * FROM merchants WHERE scene_code = $1 AND status <> 'deleted'`,
      [scene],
    );
    const merchant = result.rows[0];
    if (!merchant) {
      throw new AppException("MERCHANT_NOT_FOUND", "未找到对应商家", HttpStatus.NOT_FOUND);
    }
    if (merchant.status !== "enabled") {
      throw new AppException(
        "MERCHANT_DISABLED",
        "该商家导购服务暂不可用",
        HttpStatus.CONFLICT,
      );
    }
    return merchant;
  }

  private async getOrCreateConversation(userId: string, merchantId: string): Promise<string> {
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO conversations (user_id, merchant_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, merchant_id) DO UPDATE
         SET updated_at = conversations.updated_at
       RETURNING id`,
      [userId, merchantId],
    );
    return result.rows[0].id;
  }

  private mapMerchant(row: MerchantRow) {
    return {
      id: row.id,
      name: row.name,
      logo: row.logo,
      description: row.description,
      bannerImage: row.banner_image,
      miniProgramAppId: row.mini_program_app_id,
      sceneCode: row.scene_code,
      status: row.status,
    };
  }
}
