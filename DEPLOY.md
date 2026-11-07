# 部署到 Cloudflare

网站跑在 **Cloudflare Pages** 上，数据在 **Cloudflare D1**（托管的 SQLite）里。不需要自己的服务器，也不需要 Postgres / MySQL。

免费的 Cloudflare 账号就够用。本地开发用的 `admin` / `guest` 只存在你这台机器的 `.dev.vars` 里，**不要**原样拿到线上。

---

## 你要准备的东西

1. 一个 [Cloudflare](https://dash.cloudflare.com/) 账号。
2. Node.js 18 或更高。在项目目录里已经执行过 `npm install`。
3. 两个你自己定的密码：管理员、访客。管理员能增删改、导入、导出；访客只能看记录和浓度曲线。
4. 下面三个 **Pages secret**。密码本身不入库，只存哈希。

| Secret 名 | 是什么 | 怎么生成 |
| --- | --- | --- |
| `ADMIN_PASSWORD_HASH` | 管理员密码的哈希 | `node scripts/hash-password.mjs '管理员密码'` |
| `GUEST_PASSWORD_HASH` | 访客密码的哈希 | `node scripts/hash-password.mjs '访客密码'` |
| `COOKIE_SECRET` | 登录 Cookie 的签名密钥，64 位十六进制 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

数据库只有一个，名字固定为 `myhrt-db`，在 `wrangler.toml` 里绑定成 `DB`。表结构就是仓库里的 `schema.sql`：一张 `records` 表，用药和检查都在里面。

---

## 这个哈希是哪一种

不是 bcrypt，也不是把密码做一次 SHA-256。

脚本 `scripts/hash-password.mjs` 用的是 **PBKDF2-HMAC-SHA256**：

- 随机 16 字节盐
- 迭代 **100000** 次
- 输出 32 字节
- 盐和结果都用 base64url

整串长这样，原样存进 secret，不要加引号、不要改其中的 `$`：

```text
pbkdf2_sha256$100000$<盐>$<哈希>
```

每次运行脚本都会换一个新盐，所以同一个密码两次跑出来的字符串不一样，这是正常的。登录时 `shared/auth.js` 用 Web Crypto 按同一套参数重算，和这段字符串比对。

`COOKIE_SECRET` 不是密码哈希。它是另一串随机十六进制，用来给登录 Cookie 做 HMAC-SHA256 签名。三个值都要单独生成。

---

## 部署步骤

以下命令都在项目根目录执行。

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开授权页。授权完成后终端里应出现登录成功。

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create myhrt-db
```

输出里有一行 `database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"`。把 `wrangler.toml` 里的这一行：

```toml
database_id = "REPLACE_WITH_DATABASE_ID"
```

换成刚才那串 id，保留引号。不要改 `database_name` 和 `binding`：名字必须是 `myhrt-db`，绑定必须是 `DB`。

### 3. 建表

```bash
npx wrangler d1 execute myhrt-db --remote --file=./schema.sql
```

成功时会看到两条语句都 `success: true`（建表和两个索引）。这是空库。本地 `.wrangler/` 里的数据不会上去。

### 4. 生成三个 secret 的值

把密码换成你自己的。密码里如果有单引号，改用双引号包住，避免 shell 吃掉字符。

```bash
node scripts/hash-password.mjs '你的管理员密码'
node scripts/hash-password.mjs '你的访客密码'
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

每个命令只输出一行。复制整行，包括 `pbkdf2_sha256$` 开头的全部内容。先记在本地备忘里，下一步粘贴；设进 Cloudflare 之后终端历史里也会留下这些命令，设完可以清掉历史。

### 5. 创建 Pages 项目

```bash
npx wrangler pages project create myhrt --production-branch main
```

如果这条命令报「不支持」或项目已存在，跳过它。下一步部署时 Wrangler 也会创建同名项目。

### 6. 写入 secret

用 `printf`，不要用 `echo`。`echo` 会在末尾加一个换行，哈希对不上，登录会一直失败。

把下面三处替换成第 4 步的三行输出，每条执行一次。提示 `Enter a secret value:` 时，它已经从管道读到了值，直接回车即可。

```bash
printf '%s' '这里贴管理员那一整行哈希' | npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name myhrt
printf '%s' '这里贴访客那一整行哈希' | npx wrangler pages secret put GUEST_PASSWORD_HASH --project-name myhrt
printf '%s' '这里贴64位十六进制' | npx wrangler pages secret put COOKIE_SECRET --project-name myhrt
```

三个名字必须一字不差。确认：

```bash
npx wrangler pages secret list --project-name myhrt
```

应能看到 `ADMIN_PASSWORD_HASH`、`GUEST_PASSWORD_HASH`、`COOKIE_SECRET`。列表里只有名字，没有值。

### 7. 部署

```bash
npx wrangler pages deploy public --project-name myhrt --branch main
```

结束时会打印访问地址，一般是 `https://myhrt.pages.dev`。用这个地址打开，不要用 `http://localhost:8788`。

---

## 上线后检查

1. 打开站点，应先到登录页。
2. 身份选「管理员」，用你设定的管理员密码登录。能看到「记录用药」和「导出 JSON」。
3. 退出，再用访客密码登录。能看到记录和浓度曲线，没有「记录用药」「导入 JSON」「导出 JSON」。
4. 管理员记一条用药，曲线上应出现对应的估算。
5. 管理员导出一份 JSON，留作备份。

登录一直提示错误时，多半是 secret 带了换行或贴丢了一段。用第 6 步的 `printf` 重新写入对应的那一个，然后重新执行第 7 步部署。

---

## 以后改密码

重新生成哈希，只覆盖要改的那一个 secret，然后重新部署：

```bash
node scripts/hash-password.mjs '新的管理员密码'
printf '%s' '新的一整行哈希' | npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name myhrt
npx wrangler pages deploy public --project-name myhrt --branch main
```

访客密码把名字换成 `GUEST_PASSWORD_HASH`。已经发出的登录 Cookie 在过期前仍然有效（大约 30 天）；要立刻作废旧登录，就再换一次 `COOKIE_SECRET` 并重新部署。

改代码之后，同样只需要再执行第 7 步。表结构没变就不要重复执行 `schema.sql`。

---

## 绑定自己的域名（可选）

1. 打开 Cloudflare 控制台 → Workers & Pages → `myhrt` → Custom domains。
2. 添加域名。域名已在这个 Cloudflare 账号下时，它会自己写 DNS。
3. 等证书生效后再用该域名登录。Cookie 是按站点发的，换域名后要重新登录一次。

---

## 不要做的事

- 不要把 `.dev.vars`、密码原文、三个 secret 的值提交到 git。`.dev.vars` 已经在 `.gitignore` 里。
- 不要在 D1 里建别的表来存密码。密码只以哈希形式放在 Pages secret。
- 不要用手写 `CREATE TABLE` 代替 `schema.sql`，列名和代码是对在一起的。
- 本地 `npx wrangler pages dev` 读的是 `.dev.vars` 和本地 D1，和线上互不影响。
