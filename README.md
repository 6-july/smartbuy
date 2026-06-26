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
