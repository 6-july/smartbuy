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
| GET | `/api/admin/products` | 分页查询商品 |
| GET | `/api/admin/products/{productId}` | 查询商品详情 |
| PATCH | `/api/admin/products/{productId}/status` | 上架、下架或删除商品 |
| GET | `/api/admin/conversations` | 按商家或用户查看会话 |
| GET | `/api/admin/conversations/{conversationId}/messages` | 查看会话消息 |

## 3. 商品导入

`POST /api/admin/products/import` 接收已标准化 JSON。Excel 解析器应将 `PG商品导入` 表转换为以下驼峰字段：

```json
{
  "merchantId": "商家 UUID",
  "products": [
    {
      "source": "youzan",
      "sourceShopId": "113996920",
      "sourceProductId": "4454449501",
      "alias": "27czrcqnsbo7chx",
      "category": "蛋糕",
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
      "aiText": "商品标题，分类：蛋糕。价格188至258元。"
    }
  ],
  "deactivateMissing": false
}
```

更新规则：

- 唯一键：`merchant_id + source + source_product_id`；
- 完全相同则跳过；
- 仅更新变化字段；
- `aiText` 变化时清空并重新生成 Embedding；
- Embedding 未配置或失败时保留商品，关键词检索仍可使用；
- `deactivateMissing=false` 时，文件中缺失的历史商品保持原状态。

## 4. 开发模式

设置 `WECHAT_MOCK_ENABLED=true` 后，任意非空登录 code 会稳定映射为一个模拟 OpenID，太阳码接口返回测试 PNG。未配置 AI Chat API 时使用确定性模板回复；未配置 Embedding API 时跳过向量生成并使用关键词检索。

模型接口采用 OpenAI 兼容协议：

- Chat API：请求 `messages`，读取 `choices[0].message.content`；
- Embedding API：请求 `model + input`，读取 `data[0].embedding`。

生产环境必须关闭微信模拟模式，并配置真实微信、JWT、管理员和模型密钥。

## 5. 详细 Schema

字段、校验规则、请求示例和响应结构以生成的 [OpenAPI 文档](./api/openapi.json) 为准。
