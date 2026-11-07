# MyHRT — 个人 HRT 用药记录

一个部署在 **Cloudflare Pages + D1** 上的个人 HRT（激素替代疗法）用药记录网站。

- **管理员账号**：增删改用药记录、导入数据。
- **访客账号**：只读查看记录和浓度曲线，不能改数据，也不能导出。
- **JSON 导入/导出**：完整备份与迁移。
- **中英双语**界面，可一键切换。

数据字段：日期、药物名称（中/英）、给药方式、浓度+单位、剂量+单位、频率、血检 E2 / T、备注。

---

## 目录结构

```
├── wrangler.toml          # Pages + D1 绑定配置
├── schema.sql             # D1 建表 SQL
├── scripts/hash-password.mjs  # 生成密码哈希
├── shared/                # 后端共享工具（鉴权、记录字段）
├── functions/api/         # Pages Functions 后端路由
└── public/                # 静态前端（登录页 + 主界面）
```

---

## 前置条件

1. 一个 [Cloudflare](https://dash.cloudflare.com/) 账号。
2. 安装 Node.js（≥ 18）。

---

## 本地开发

```bash
cd MyHRT
npm install

# 1) 生成密码哈希与 Cookie 密钥
node scripts/hash-password.mjs '你的管理员密码'
node scripts/hash-password.mjs '你的访客密码'
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2) 复制 .dev.vars.example 为 .dev.vars，填入上面三个值
cp .dev.vars.example .dev.vars

# 3) 建本地 D1 并启动
npx wrangler d1 execute myhrt-db --file=./schema.sql --local
npx wrangler pages dev public
```

打开 `http://localhost:8788` 即可。

---

## 部署

上线步骤、三个 secret 分别是什么、密码哈希怎么生成，写在 [DEPLOY.md](./DEPLOY.md)。按那一份自己部署即可。

---

## 使用说明

- **登录**：打开网站 → 选择身份（管理员/访客）→ 输入密码。
- **管理员**：顶部有「新增记录」「导入 JSON」按钮；每条记录卡片有「编辑」「删除」。
- **访客**：只能浏览与「导出 JSON」，无任何写操作入口。
- **导出**：顶部「导出 JSON」下载全量数据文件（含 `id` 与全部字段）。
- **导入**：选择导出的 JSON 文件即可；**按 `id` 合并**——已有 `id` 覆盖更新，无 `id` 的新增。
- **筛选**：顶部可设置开始/结束日期过滤记录。
- **语言**：右上角下拉切换中文 / English。

### 导出 JSON 格式示例

```json
[
  {
    "id": 1,
    "date": "2026-09-01",
    "drug_name": "戊酸雌二醇",
    "drug_name_en": "Estradiol Valerate",
    "route": "注射 (IM)",
    "concentration": "40",
    "concentration_unit": "mg/mL",
    "dose": "0.1",
    "dose_unit": "mL",
    "frequency": "每5天",
    "e2": "180 pg/mL",
    "t": "20 ng/dL",
    "notes": "…",
    "created_at": "…",
    "updated_at": "…"
  }
]
```

---

## 修改密码

见 [DEPLOY.md](./DEPLOY.md) 里的「以后改密码」。要用 `printf` 写入哈希，不要用 `echo`，否则末尾换行会导致登录失败。

---

## 说明与注意事项

- 本方案使用 **Cloudflare Pages**（官方对新项目推荐 Workers Static Assets，Pages 处于“维护模式”，但对本项目这种“文件即路由 + 零构建”的需求最贴合；日后可低成本迁移到 Workers）。
- 鉴权为**无状态 HMAC 签名 Cookie**（30 天有效），密码用 PBKDF2-SHA256（10 万次迭代）哈希存储。
- 三个 secret 均为项目级，作用于生产与预览环境；本地用 `.dev.vars` 覆盖。
- 本应用不含 HTTPS 外的任何外部请求，数据仅存在你自己的 D1 数据库中。
