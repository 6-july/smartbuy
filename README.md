# SmartBuy

智能导购小程序项目。

## 目录结构

```text
smartbuy/
├── frontend/
│   ├── miniprogram/  # 微信小程序端
│   ├── web/          # Web 前端，预留
│   └── admin/        # 内部管理端，预留
├── backend/
│   ├── bff/          # 面向前端的小程序业务接口服务
│   └── ai/           # AI 检索、导购回复和知识库相关服务
└── docs/             # 项目文档、需求文档和设计图
```

## 命名说明

- `frontend`、`backend`、`miniprogram`、`admin`、`bff`、`ai` 拼写均已确认。
- `miniprogram` 用作微信小程序目录名，保持小写无连字符，方便工程工具识别。

## 用户小程序

用户端位于 `frontend/miniprogram`，使用 Taro 4 + React + TypeScript。

```bash
# 微信开发者工具联调，默认连接 http://127.0.0.1:3000
pnpm dev:miniprogram

# 真机联调时改为开发电脑的局域网地址
TARO_APP_API_BASE=http://192.168.x.x:3000 pnpm dev:miniprogram

# 正式构建必须使用已加入微信合法域名的 HTTPS 地址
TARO_APP_API_BASE=https://api.example.com pnpm --filter @smartbuy/miniprogram build:weapp

# H5 联调，/api 默认代理到本机 3000 端口
pnpm dev:miniprogram:h5

```

项目已配置正式小程序 AppID。部署前还需要设置 `TARO_APP_API_BASE`，并将对应的
HTTPS 域名加入微信小程序合法域名。
