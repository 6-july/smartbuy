# SmartBuy 服务端 API 文档

## 1. 访问方式

| 项目 | 地址/说明 |
|---|---|
| API Base URL | `/api` |
| Swagger UI | `/api/docs` |
| OpenAPI JSON | `/api/openapi.json` |
| OpenAPI YAML | `/api/openapi.yaml` |
| 用户鉴权 | `Authorization: Bearer <token>` |
| 内部管理鉴权 | `x-admin-token: <ADMIN_SERVICE_TOKEN>` |

本地启动：

```bash
pnpm install
pnpm build
pnpm dev:bff
```

启动前在 `backend/bff/.env` 配置数据库、JWT 和管理员凭证；可参考 `backend/bff/.env.example`。禁止将真实密钥提交到仓库。

错误响应统一包含：

```json
{
  "code": "STABLE_ERROR_CODE",
  "message": "可读错误信息",
  "details": null,
  "requestId": "请求追踪 ID"
}
```

## 2. 接口清单

### 2.1 公共接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 无 | 检查服务与数据库 |
| POST | `/api/auth/wechat-login` | 无 | 微信 code 登录/注册 |
| POST | `/api/merchant/scan` | 可选 | 解析太阳码；登录后复用会话 |

### 2.2 用户接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/conversations` | 获取当前用户历史商家会话 |
| GET | `/api/merchant/{merchantId}/guide-info` | 获取商家信息和固定会话 |
| GET | `/api/conversation/{conversationId}/messages` | 获取当前用户会话消息 |
| POST | `/api/conversation/{conversationId}/message` | 发送问题并获取 AI 回复与商品卡片 |

### 2.3 内部管理接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/merchants` | 创建商家 |
| POST | `/api/admin/merchants/{merchantId}/solar-code` | 生成商家太阳码 PNG |
| POST | `/api/admin/products/import` | 幂等导入标准化商品列表 |
| POST | `/api/admin/products/import-csv` | 上传商品 CSV，并按商家范围同步上下架 |
| GET | `/api/admin/products` | 分页查询商品 |
| GET | `/api/admin/products/{productId}` | 查询商品详情 |
| PATCH | `/api/admin/products/{productId}/status` | 上架或下架商品 |
| GET | `/api/admin/conversations` | 按商家或用户查看会话 |
| GET | `/api/admin/conversations/{conversationId}/messages` | 查看会话消息 |

## 3. 商品导入

`POST /api/admin/products/import-csv` 接收 `multipart/form-data`：

| 字段 | 说明 |
|---|---|
| `merchantId` | 当前系统内商家 UUID，用于约束导入范围 |
| `file` | 吾安商品 CSV，支持 `商家id/商品id/商品名称/分类/商品图/规格信息/规格摘要/推荐/标签/销量` 等中文表头 |

CSV 映射规则：

- `商品id` 映射为 `sourceProductId`，逐条按 `merchant_id + source_product_id` 对比；
- `商家id` 映射为 `sourceShopId`，落库到 `source_shop_id`；
- `规格摘要` 映射为 `optionsText`；如果 CSV 没有该列，则从 `规格信息` 兜底生成；
- CSV 中出现的商品一律按 `on_sale` 导入，不读取 CSV 的上架状态；
- 当前 `merchantId` 下没有出现在 CSV 的商品，会被改为 `off_sale`，不会影响其他商家。

`POST /api/admin/products/import` 仍接收已标准化 JSON：

```json
{
  "merchantId": "商家 UUID",
  "products": [
    {
      "source": "youzan",
      "sourceShopId": "113996920",
      "sourceProductId": "4454449501",
      "alias": "27czrcqnsbo7chx",
      "category": "送长辈;儿童蛋糕",
      "title": "商品标题",
      "description": "",
      "displayPrice": 188,
      "minPrice": 188,
      "maxPrice": 258,
      "images": [],
      "sales": 29,
      "isRecommended": false,
      "options": [],
      "tags": [],
      "optionsText": "必须：尺寸 4寸¥188、6寸¥258；喜好：口味 海盐奥利奥；附属：蜡烛、餐具"
    }
  ],
  "deactivateMissing": false
}
```

更新规则：

- 唯一键和实际对比范围：`merchant_id + source_product_id`；
- `sourceShopId` 对应数据库字段 `source_shop_id`，用于保存外部商家 ID；
- `category` 可为空；多分类建议用英文分号 `;` 分隔；
- 完全相同则跳过；
- 仅更新变化字段；
- 导入文件中出现的商品默认恢复为 `on_sale`；
- `saleStatus` 仅保留 `on_sale` 和 `off_sale` 两种状态；
- `optionsText` 用于保存规格摘要，导入时按普通字段更新；
- CSV 导入会自动下架当前商家下缺失的商品；JSON 导入只有 `deactivateMissing=true` 时才下架缺失商品。

## 4. 开发模式

设置 `WECHAT_MOCK_ENABLED=true` 后，任意非空登录 code 会稳定映射为一个模拟 OpenID，太阳码接口返回测试 PNG。未配置 AI Chat API 时使用确定性模板回复。

模型接口采用 OpenAI 兼容协议：

- Chat API：请求 `messages`，读取 `choices[0].message.content`。

生产环境必须关闭微信模拟模式，并配置真实微信、JWT、管理员和模型密钥。

## 5. 详细 Schema

字段、校验规则、请求示例和响应结构以生成的 [OpenAPI 文档](./api/openapi.json) 为准。
