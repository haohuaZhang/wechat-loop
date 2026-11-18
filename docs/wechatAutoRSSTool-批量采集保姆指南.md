# wechatAutoRSSTool 批量采集公众号 · 保姆级指南

> 仓库：https://github.com/x554960766/wechatAutoRSSTool
> 版本：2.3.8（源码 `backend/config.py:19`）
> 本指南只讲**微信公众号批量采集**这条主线，抖音/快手/小红书/B站/视频号全部略过。

## 证据说明（先看这条）

本文所有接口路径、参数、常量均来自**逐行阅读源码**，不是猜测：

- 登录：`backend/auth.py`
- 账号池：`backend/account_pool.py`
- 签名/节流/会话激活：`backend/weread_signer.py`
- 公众号搜索与关注列表：`backend/accounts.py`
- 文章列表与下载任务：`backend/articles.py`
- 正文抓取：`backend/downloader.py`
- 配置与路径：`backend/config.py`
- 路由注册：`app_mp.py`

**未实机联调**：编写本文的环境无法出网访问 `i.weread.qq.com`，所以文中没有真实响应体截图。
每节末尾都给了「怎么自己验证」的命令，你本机跑一遍即可确认。

---

## 0. 一句话结论

它不是去破解微信公众平台后台，也不是用 wechatDownload 那套抓包。

它的做法是：

> **把「微信读书」当成一台公众号聚合服务器**，用一个微信读书账号登录后，
> 通过微信读书的官方 App 接口拿到「公众号 → 文章列表」，
> 再回到 `mp.weixin.qq.com` 用移动端微信 UA 抓正文。

一句话记住三个等式：

```
公众号 = 微信读书里的一本"书"        bookId = MP_WXS_{uin}
一篇文章 = 这本书的一个"章节/review"   reviewId
正文 = mp.weixin.qq.com/s/{short_id}   ← 从 reviewId 里就能拼出来
```

---

## 1. 为什么这条路能绕开 200013

| 路线 | 卡在哪 |
|---|---|
| 公众平台后台 `searchbiz` / `appmsg` | 账号级频控 `200013`，一个号一天基本只能翻几十篇 |
| wechatDownload 抓包 | 依赖 Windows 客户端，Mac 缺 `get_public_account_id` |
| **微信读书通道（本项目）** | 频控是 `-2014`，冷却只有几十秒，且**可以换账号绕过** |

关键差别：**微信读书的限流是"按账号"的，而公众号后台的限流是"按公众号主体 + 账号"的**。
所以微信读书这条路天然适合做**账号池**——A 号打到冷却就换 B 号，这是全项目的技术核心（见第 8 节）。

---

## 2. 环境准备与启动

### 2.1 依赖

```bash
git clone https://github.com/x554960766/wechatAutoRSSTool.git
cd wechatAutoRSSTool
pip3 install -r requirements-mp.txt
```

`requirements-mp.txt` 里实际需要的就这几个：

```
flask>=3.0
flask-cors>=4.0
requests>=2.31
beautifulsoup4>=4.12
playwright>=1.40   # 只有"无头浏览器兜底"用得到，可不装
pymysql>=1.1.0     # 可选
certifi
```

Python 要求 **3.10+**（代码里大量使用 `str | None` 写法）。

如果要用无头浏览器兜底：

```bash
python3 -m playwright install chromium
```

### 2.2 启动

```bash
python3 app_mp.py --host 127.0.0.1 --port 5200
```

- 默认就是 `127.0.0.1:5200`（`app_mp.py:145-146`）
- `--host 0.0.0.0` 才会对外暴露，**不建议**，因为里面存着你的登录凭证
- 前端界面已经打包在 `frontend/` 里，由同一个 Flask 直接托管（`app_mp.py:48-49`）
- 打开浏览器访问 `http://127.0.0.1:5200` 就是完整 UI

### 2.3 数据目录

启动后会在项目下生成 `data/`：

```
data/
├── account_pool.json      # 账号池（核心！多个微信读书账号的凭证）
├── accounts.json          # 你关注的公众号列表
├── download_history.json  # 下载历史（用于跳过已存在文章）
├── app_settings.json      # 延迟、重试、输出目录等
├── wechat_tools.db        # SQLite：公众号表 + 下载索引（用来判重）
└── articles_full/         # 正文产物
    └── {公众号名}/{文章标题}/
        ├── index.html
        ├── data.json
        ├── images/
        └── video/
```

路径定义见 `backend/config.py:31-39`。

### 2.4 验证

```bash
curl http://127.0.0.1:5200/api/auth/status
```

返回里如果没有 `accessToken`、只显示账号列表为空，说明还没登录 → 看第 4 节。

---

## 3. 先搞懂这几个 ID（最容易懵的地方）

| 名字 | 长什么样 | 从哪来 | 用在哪 |
|---|---|---|---|
| `__biz` / `fakeid` | `MzA5MjU4NzMyOA==` | 公众号唯一 ID（Base64） | 微信读书搜索接口返回 |
| `bookId` | `MP_WXS_3528995129` | 微信读书内部 ID | 拉列表用 |
| `reviewId` | `MP_WXS_3528995129_yvrxT0XE-9ELBG4gQZhB4g` | 列表接口每条返回 | 拉正文用 |
| 短链 | `https://mp.weixin.qq.com/s/yvrxT0XE-9ELBG4gQZhB4g` | 从 reviewId 尾巴直接拼 | 抓正文用 |

### 3.1 `__biz` ⇄ `bookId` 互转

`backend/accounts.py:25-56`：

```python
def biz_to_book_id(fakeid_or_biz):
    raw = urllib.parse.unquote(fakeid).strip()      # MzA5MjU4NzMyOA==
    decoded = base64.b64decode(raw).decode()        # "3528995129"
    return f"MP_WXS_{decoded}"                      # MP_WXS_3528995129
```

反向同理：`MP_WXS_3528995129` → Base64(`3528995129`) → `MzA5MjU4NzMyOA==`。

> 记住这一条，你就看懂了整个项目的 ID 体系：**`__biz` 解开后就是一个 uin 数字，微信读书把它拼成 `MP_WXS_{uin}` 当书号。**

### 3.2 `reviewId` → 短链

`backend/articles.py:243-251`：

```python
# reviewId = MP_WXS_2940696320_yvrxT0XE-9ELBG4gQZhB4g
short_id = review_id.split("_")[-1]        # yvrxT0XE-9ELBG4gQZhB4g
doc_url  = f"https://mp.weixin.qq.com/s/{short_id}"
```

**短链是免风控的关键**：长链 `?__biz=...&mid=...&idx=...&sn=...` 容易弹验证码，`/s/{short}` 直接返回正文。

---

## 4. 第一步：扫码登录（接口级全流程）

这是全项目唯一需要「人工」的环节（属于 L4，不能自动化绕过）。

### 4.1 时序图

```
你的程序                 i.weread.qq.com          open.weixin.qq.com        你的手机微信
   │                          │                          │                      │
   │ 1. GET /wxticket         │                          │                      │
   │─────────────────────────>│                          │                      │
   │<── timeStamp, signature  │                          │                      │
   │                          │                          │                      │
   │ 2. GET /connect/sdk/qrconnect?appid=...&signature=   │                      │
   │───────────────────────────────────────────────────->│                      │
   │<── uuid + qrcodebase64   │                          │                      │
   │                          │                          │                      │
   │ 3. 轮询 /connect/l/qrconnect?uuid=xxx&last=yyy       │                      │
   │───────────────────────────────────────────────────->│                      │
   │                          │                          │<──── 扫码 + 确认 ────│
   │<── wx_errcode=405, wx_code                           │                      │
   │                          │                          │                      │
   │ 4. POST /login  {code, deviceId, timestamp,          │                      │
   │                  random, signature=sha256(...)}      │                      │
   │─────────────────────────>│                          │                      │
   │<── accessToken, refreshToken, vid, skey, user        │                      │
   │                          │                          │                      │
   │ 5. 写入 data/account_pool.json，并 mobileSync 激活会话 │                      │
```

### 4.2 拆开看每一步

**① 拿 wxticket**（`backend/auth.py:67-72`）

```http
GET https://i.weread.qq.com/wxticket?nonceStr=weread
→ {"timeStamp": "...", "signature": "..."}
```

**② 换二维码**（`backend/auth.py:75-90`）

```http
GET https://open.weixin.qq.com/connect/sdk/qrconnect
    ?appid=wxab9b71ad2b90ff34
    &noncestr=weread
    &timestamp={timeStamp}
    &scope=snsapi_userinfo,snsapi_timeline,snsapi_friend,snsapi_favorites
    &signature={signature}
→ {"uuid": "...", "qrcode": {"qrcodebase64": "..."}}
```

`appid` 是微信读书的开放平台 AppID，写死在源码里（`auth.py:78`）。
如果没返回 base64，就退回图片地址：`https://open.weixin.qq.com/connect/qrcode/{uuid}`（`auth.py:295`）。

**③ 轮询扫码状态**（`backend/auth.py:146-236`）

```http
GET https://long.open.weixin.qq.com/connect/l/qrconnect?f=json&uuid={uuid}&last={last}
```

| `wx_errcode` | 含义 | 程序动作 |
|---|---|---|
| `408` | 还没扫 | 继续轮询 |
| `404` | 扫了，等你点确认 | 前端提示「已扫码」 |
| `405` | **确认成功** | 拿 `wx_code` 去换 token |
| `402` / `403` | 二维码过期 | 让用户刷新 |

注意轮询是**长轮询**：`timeout=28`，最长等 300 秒（`auth.py:157,160`）。

**④ 用 code 换 Token**（`backend/auth.py:93-143`）

```http
POST https://i.weread.qq.com/login
Content-Type: application/json

{
  "code": "{wx_code}",
  "deviceId": "3f2a...",          // 随机 md5，一号一机
  "trackId": "",
  "timestamp": 1731650000000,      // 毫秒
  "random": 137,                   // 0~999
  "signature": "sha256(timestamp + deviceId + random)",
  "wxToken": 1,
  "appFirstInstall": 0,
  "virtualChannelId": "",
  "installId": "uuid4",
  "isFromQrcode": 1,
  "isAutoLogout": 0,
  "deviceName": "Xiaomi 14",
  "deviceType": 1
}
```

签名算法只有一行（`auth.py:93-95`）：

```python
def calculate_anti_replay_signature(device_id, timestamp, rand_val):
    return hashlib.sha256(f"{timestamp}{device_id}{rand_val}".encode()).hexdigest()
```

成功返回：

```json
{
  "vid": "123456789",
  "accessToken": "...",
  "refreshToken": "...",
  "skey": "...",
  "user": {"name": "微信读书用户", "avatar": "..."}
}
```

**⑤ 落库 + 激活会话**（`backend/auth.py:176-215`）

入库后立刻调 `activate_terminal_session()`，向 `/mobileSync` 汇报一次移动端同步态。
不做这一步，新账号第一次请求 `/mp/chapters` 很容易收到 `499 -2041`（会话未激活）。

### 4.3 你手动就能调的三个接口

```bash
# 1) 生成二维码（返回 base64 图片，前端直接 <img src>）
curl -X POST http://127.0.0.1:5200/api/auth/qrcode

# 2) 轮询登录状态（前端每秒调一次）
curl http://127.0.0.1:5200/api/auth/status

# 3) 退出 / 取消
curl -X POST http://127.0.0.1:5200/api/auth/cancel
curl -X POST http://127.0.0.1:5200/api/auth/logout
```

> `GET /api/auth/qrcode` 和 `POST` 等价（`auth.py:284`）。

### 4.4 已经有 Token，不想扫码？

直接导入（`backend/auth.py:359-378`）：

```bash
curl -X POST http://127.0.0.1:5200/api/auth/manual \
  -H 'Content-Type: application/json' \
  -d '{
    "vid": "123456789",
    "accessToken": "xxxxx",
    "refreshToken": "yyyyy",
    "nickname": "备用号1"
  }'
```

只要有 `refreshToken`，`accessToken` 过期也能自动续（见 8.3）。

另有一个完全自动化的登录入口（用 Playwright 打开真实微信扫码页，扫码后自动把凭证吸进账号池）：

```bash
curl -X POST http://127.0.0.1:5200/api/auth/login-browser
```

> 适合「没有前端、纯脚本跑」的场景。底层还是第 4.1 节那套流程，只是把「展示二维码 + 轮询」
> 交给了无头浏览器。需要先 `playwright install chromium`。

还有一个体检接口，确认当前凭证到底还能不能用：

```bash
curl http://127.0.0.1:5200/api/auth/check-credentials
```

### 4.5 验证登录成功

```bash
curl -s http://127.0.0.1:5200/api/auth/status
```

应能看到 `nickname`、`vid`、`token_preview`（打码后的 token）。
同时 `data/account_pool.json` 里会多一条 `"status": "active"` 的记录。

---

## 5. 第二步：搜公众号，拿到 fakeid

### 5.1 接口

```bash
curl -X POST http://127.0.0.1:5200/api/accounts/search \
  -H 'Content-Type: application/json' \
  -d '{"keyword": "游戏研究社"}'
```

底层打的是微信读书的书城搜索（`backend/accounts.py:198-199`）：

```http
GET https://i.weread.qq.com/store/search?keyword={urlencode(keyword)}&scope=2&v=2&count=20
```

`scope=2` 就是「只搜公众号」。

返回：

```json
{
  "results": [
    {
      "fakeid": "MzA5MjU4NzMyOA==",
      "bookId": "MP_WXS_3528995129",
      "nickname": "游戏研究社",
      "round_head_img": "https://...",
      "signature": "简介...",
      "service_type": 1
    }
  ],
  "total": 1
}
```

### 5.2 搜索兜底

`scope=2` 搜不到时，退回通用搜索 `?keyword=&v=2&count=20`，
再手动筛出 `bookId` 以 `MP_` 开头的（`accounts.py:270-290`）。

### 5.3 收藏公众号（存进 accounts.json）

```bash
curl -X POST http://127.0.0.1:5200/api/accounts \
  -H 'Content-Type: application/json' \
  -d '{"fakeid":"MzA5MjU4NzMyOA==","nickname":"游戏研究社"}'
```

这一步很重要：`collect-all`（全部号采集）读的就是这个文件。

### 5.4 也可以直接读「我关注的公众号」

```bash
curl http://127.0.0.1:5200/api/accounts/user-mps
```

内部依次打（`accounts.py:531-578`）：

```http
GET https://i.weread.qq.com/mp/list?listType=0&count=50&synckey=0
GET https://i.weread.qq.com/mp/list?listType=1&count=50&synckey=0
GET https://i.weread.qq.com/shelf/sync?synckey=0&teenmode=0&album=1&onlyBookid=0&localBookCount=0
```

即：你在微信读书 App 里「关注」过的公众号，这里能直接列出来，不用一个个搜。
结果缓存 120 秒。

---

## 6. 第三步：拉文章列表（核心接口）

### 6.1 REST 接口

```bash
curl "http://127.0.0.1:5200/api/articles/list/MzA5MjU4NzMyOA==?begin=0&count=10"
```

参数（`backend/articles.py:574-579`）：

| 参数 | 含义 |
|---|---|
| `fakeid` | 路径参数，`__biz` 或 `MP_WXS_xxx` 都行 |
| `begin` | 偏移量，从 0 开始 |
| `count` | 本次拉几篇（建议 10~20） |
| `keyword` | 可选，标题过滤 |
| `from_article_id` | 可选，指定从某篇往前翻 |

返回：

```json
{
  "articles": [
    {
      "title": "S15 世界赛：LPL 的三年",
      "link": "https://mp.weixin.qq.com/s/yvrxT0XE-9ELBG4gQZhB4g",
      "cover": "https://mmbiz.qpic.cn/...",
      "digest": "摘要...",
      "author": "游戏研究社",
      "update_time": 1761650000,
      "is_original": true,
      "id": "MP_WXS_3528995129_yvrxT0XE-9ELBG4gQZhB4g"
    }
  ],
  "total": 120,
  "can_msg_continue": true,
  "begin": 0,
  "count": 10
}
```

### 6.2 内部三级取数（`articles.py:405-477`）

**① 主通道：`mp/chapters`**（官方标准分页接口）

```http
# 第一页（首页）
GET https://i.weread.qq.com/mp/chapters?bookId=MP_WXS_3528995129&count=10&pf=android&synckey=0

# 翻页（注意：不带 pf 和 synckey）
GET https://i.weread.qq.com/mp/chapters?bookId=MP_WXS_3528995129&count=10&offset=10
```

这个 `pf=android&synckey=0` vs `offset=` 的差异不是随便写的，是照着官方 APK
`MpRemoteService` 的「首页 syncChapters / 翻页 loadMoreChapters」行为对齐的（源码注释 `articles.py:414`）。

**② 备用：`article/list`**（仅当 bookId 不是 `MP_` 开头）

```http
GET https://i.weread.qq.com/article/list?bookId={bookId}&synckey=0
```

公众号走不到这里——官方 APK 里 `MP_` 类型没有这个接口，硬打只会吃 499。

**③ 兜底：`mp/cover`**（只在第一页、且前两条都空时）

```http
GET https://i.weread.qq.com/mp/cover?bookId=MP_WXS_3528995129
→ {"reviewId": "...", "title": "...", "pic": "..."}
```

只能拿**最新一篇**，成功率高，用来保底「至少能采到东西」。

### 6.3 补齐 doc_url / 时间 / 原创标记

列表接口返回的字段常常缺 `link` 和时间，于是对每条并发调（`articles.py:479-520`）：

```http
GET https://i.weread.qq.com/review/single?reviewId={reviewId}
```

从 `review.mpInfo` 里取 `doc_url`、`originalId`、`createTime`、`title`、`digest`、`author`、`pic_url`、`copyright_type`。

> 有缓存（`_review_info_cache`），同一个 reviewId 只查一次，避免多余请求。

### 6.4 分页怎么翻才算「翻完」

`articles.py:1645-1649`：

```python
if not can_continue or len(articles) < page_size:
    break
begin += len(articles)
time.sleep(random.uniform(0.5, 0.9))   # 翻页间隔 0.5~0.9 秒
```

即：**返回条数不足一页 / 服务端说没有更多 → 停**。翻页之间有 0.5~0.9 秒随机间隔。

---

## 7. 第四步：四种批量采集方式（含 curl）

### 7.1 方式 A：单号最近 N 篇

```bash
curl -X POST http://127.0.0.1:5200/api/articles/collect-latest \
  -H 'Content-Type: application/json' \
  -d '{
    "fakeid": "MzA5MjU4NzMyOA==",
    "account_name": "游戏研究社",
    "limit": 50,
    "skip_existing": true
  }'
→ {"task_id": "collect_1761650000", "message": "已启动【游戏研究社】一键采集任务（最近 50 篇）"}
```

### 7.2 方式 B：全部关注号，各采最近 N 篇

```bash
curl -X POST http://127.0.0.1:5200/api/articles/collect-all \
  -H 'Content-Type: application/json' \
  -d '{"limit": 20, "skip_existing": true}'
```

读 `data/accounts.json`，**一个号一个号串行**跑，号之间休息 2.0~3.5 秒（`articles.py:1704-1713`）。
这是最省心的批量化入口。

### 7.3 方式 C：按日期范围

```bash
curl -X POST http://127.0.0.1:5200/api/articles/download-range \
  -H 'Content-Type: application/json' \
  -d '{
    "fakeid": "MzA5MjU4NzMyOA==",
    "account_name": "游戏研究社",
    "start_time": 1730390400,
    "end_time": 1732982400,
    "page_size": 10
  }'
```

注意：**微信读书的列表接口不支持时间过滤**，所以实现是「一边翻页一边按 `update_time` 过滤」。
因此日期范围越久远，翻的页数越多，越容易被频控——建议配合账号池使用。

### 7.4 方式 D：给链接 / 给列表直接下

```bash
# 4-1 给一批文章链接（自动去重、自动从长链解析成短链）
curl -X POST http://127.0.0.1:5200/api/articles/download-url \
  -H 'Content-Type: application/json' \
  -d '{"urls": ["https://mp.weixin.qq.com/s/xxxx", "https://mp.weixin.qq.com/s?__biz=...&mid=..."]}'

# 4-2 已经拿到列表 JSON，直接下
curl -X POST http://127.0.0.1:5200/api/articles/download \
  -H 'Content-Type: application/json' \
  -d '{
    "account_name": "游戏研究社",
    "articles": [{"title": "...", "link": "https://mp.weixin.qq.com/s/xxxx", "id": "MP_WXS_..._xxx"}]
  }'
```

### 7.5 轮询任务进度

```bash
curl http://127.0.0.1:5200/api/articles/download-status/collect_1761650000
```

返回结构（`articles.py:766-779` 初始化）：

```json
{
  "status": "running",
  "mode": "collect",
  "total": 50,
  "completed": 12,
  "failed": 0,
  "scanned": 12,
  "current": "【游戏研究社】S15 世界赛：LPL 的三年",
  "account_name": "游戏研究社",
  "results": [
    {"title": "...", "success": true, "path": "/.../articles_full/游戏研究社/xxx"}
  ]
}
```

其他状态取值：`completed` / `cancelled` / `failed` / `cancelling`。

取消：

```bash
curl -X POST http://127.0.0.1:5200/api/articles/download-cancel/collect_1761650000
```

> ⚠️ 任务状态**存在内存里**（`_download_tasks` 字典），进程重启就丢。
> 这是上游的已知设计，你们的集成层不要依赖它做持久化。

### 7.6 「跳过已存在」是怎么判断的

`articles.py:1667-1694`，两层判断：

1. 查 SQLite/文件索引：`is_article_downloaded(account_name, link, title)`
2. 扫 `download_history.json`：`link` 相同，或 `title + account` 相同，**且文件路径真实存在**

只有这两层都判「没有」，才会真的去下载。
所以重复跑 `collect-all` 不会重复下载，只会补新增的文章。

---

## 8. 账号池原理（全项目最值钱的部分）

> 文件：`backend/account_pool.py`（990 行）

### 8.1 为什么需要账号池

微信读书对 `mp/chapters`、`store/search` 的限流是**按账号**的：

| 错误 | 含义 | 默认处置 |
|---|---|---|
| `-2014` | 瞬时高频 | 该账号冷却 **30 秒** |
| `429` / `499` / `403` | 网关限流 | 该账号冷却 **60 秒** |
| `401` / `-2001` / `-2002` | Token 过期 | 自动静默续期，失败则标记 `invalid` |
| `-2041` | 会话未激活 / 人机验证 | 先 `mobileSync` 激活；仍失败 → 弹滑块 |
| 连续失败 5 次 | 账号疑似不可用 | 踢出（`invalid`，`FAILURE_KICK_THRESHOLD = 5`） |

单账号硬扛的结果就是：翻到第 3 页开始 499，然后一路挂到底。
**账号池的作用就是：某个号进冷却时，立刻换下一个号继续，总体吞吐不降。**

### 8.2 数据结构：`data/account_pool.json`

```json
[
  {
    "id": "acc_weread_123456789",
    "vid": "123456789",
    "accessToken": "xxx",
    "refreshToken": "yyy",
    "skey": "zzz",
    "deviceId": "3f2a...",
    "deviceName": "Xiaomi 14",
    "installId": "uuid4",
    "userAgent": "WeRead/8.x ...",
    "nickname": "备用号1",
    "avatar": "https://...",
    "status": "active",
    "failures": 0,
    "cooldown_until": 0,
    "last_used": 1761650000,
    "loginAt": 1761000000,
    "refreshedAt": 1761600000,
    "lastActiveAt": 1761640000,
    "refreshTokenExpired": false,
    "last_error": null
  }
]
```

关键字段：

- `id` = `acc_weread_{vid}`，稳定唯一（`account_pool.py:43-48`）
- `deviceId / deviceName / installId` = **一号一机设备指纹**
- `status` = `active` / `cooldown` / `invalid`
- `failures` = 连续失败计数，成功一次清零

### 8.3 一号一机：设备指纹为什么要随机

`account_pool.py:69-82`：

```python
def generate_random_device_profile():
    model, brand, _ = random.choice(RANDOM_DEVICE_MODELS)  # 14 种真实机型
    return {
        "deviceId": md5(uuid4()),      # 每号不同
        "deviceName": model,            # 小米14 / Mate60 / S24 ...
        "installId": str(uuid4()),      # 每号不同
        "deviceType": 1,
        "userAgent": APK_USER_AGENT,
    }
```

14 个候选机型写死在 `RANDOM_DEVICE_MODELS`（`account_pool.py:51-66`）。
意义：**同一个手机模型 + 同一个 deviceId 登录多个微信读书账号，在风控侧是可关联的**。
一号一机，是降低「批量养号被连坐」的概率。

### 8.4 调度算法：`acquire()`

`account_pool.py:165-219`，按顺序做 4 件事：

```python
# ① 自愈：冷却到期的号自动恢复 active
for acc in accounts:
    if acc["status"] == "cooldown" and now >= acc["cooldown_until"]:
        acc["status"] = "active"

# ② 没有可用号？尝试刷新一个 invalid 但 refreshToken 还没死的号
active = [a for a in accounts if a["status"] == "active"]
if not active:
    for acc in invalid_with_rf:
        if self._refresh_account_locked(acc):
            active.append(acc); break

# ③ 全都在冷却？取「最快恢复」的那个兜底（避免 mp/cover 这类保底接口被卡死）
if not active:
    cooldown_accs.sort(key=lambda a: a["cooldown_until"])
    return cooldown_accs[0]

# ④ 排序选号：先按失败次数升序，再按最久未用升序
active.sort(key=lambda a: (a["failures"], a["last_used"]))
selected = active[0]
selected["last_used"] = now
```

这个排序等价于：**优先用「没出过错」的号；同样健康时，轮着用最久没用的号**——天然实现了均衡轮换。

### 8.5 状态上报：`report()`

`account_pool.py:227-310`，调用方每次请求完都要汇报结果：

```python
report(account_id, status_code=..., ret=..., error_msg=...)
```

处理链：

```
成功         → failures = 0，清空 last_error
401 / -2001  → 单飞静默续期；成功继续用；失败标 invalid 并推「需要重新扫码」事件
-2041 (499)  → mobileSync 激活；成功清错；仍失败 → 判定 TCaptcha 人机验证
-2014        → status=cooldown, cooldown_until = now+30
429/403/499/-2013 → status=cooldown, cooldown_until = now+60
其他         → failures += 1；>=5 次 → invalid + 推「踢出」事件
```

注意 `-2014` 和 `429` 的差别：前者是「瞬时并发过高」，只罚 30 秒；后者更像网关级限流，罚 60 秒。

### 8.6 静默续期：`_refresh_account_locked()`

`account_pool.py:331-...`

- 用 `refreshToken` 换新 `accessToken`，**不打扰用户**
- **单飞锁**：多线程同时遇到 401 时，只有一个线程真去刷新，其他线程复用结果
  （靠 `expected_access_token` 比对实现，`account_pool.py:340-348`）
- 续期返回 `-2013` → 标记 `refreshTokenExpired = True`，不再无谓重试，等人工重新扫码
- 刷新成功后会把新 token 原子写回 `.session.json`（如果存在旧格式会话文件）

### 8.7 保活线程

`account_pool.py:968-...`：

> 每 **5 分钟**扫一次，超过 **40 分钟**没续期的账号，主动续一次。
> 注释原话：「模拟 App 前后台切换保活」。

微信读书对「长期不发请求的 token」会降权，所以要有这个心跳。

### 8.8 请求节流（三层）

| 层级 | 位置 | 参数 |
|---|---|---|
| 单请求最小间隔 | `weread_signer.py:76-88` | `WEREAD_MIN_INTERVAL=0.35s` + 随机 0.05~0.18s |
| 冷却窗口 | `weread_signer.py:91-104` | 命中 -2014 后 `RATE_LIMIT_COOLDOWN=15s` 内**所有** i.weread 请求直接短路 |
| 业务间隔 | `articles.py:1649,1700,1706` | 翻页 0.5~0.9s；逐篇下载 1.2~2.2s；跨公众号 2.0~3.5s |

> 这三层是叠加生效的。换句话说，即使你手动连发 10 个请求，服务端实际也只按 ~0.35s 的节奏发出去。

### 8.9 批量下载的退避

`articles.py:1275-1286`：

```python
for attempt in range(1, max_retries + 1):        # 默认 3 次
    result = download_single_article(...)
    if result["success"]: break
    if attempt < max_retries:
        sleep_backoff(attempt, base=1.0, cap=8.0)   # 指数退避 + 抖动
```

`base=1.0, cap=8.0`：约 1s → 2s → 4s，上限 8s，每次带随机抖动。

### 8.10 账号池 API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/account-pool` | 列出所有账号（**脱敏**，token 只显示前后 4 位） |
| GET | `/api/account-pool/summary` | 汇总：几个 active / cooldown / invalid |
| POST | `/api/account-pool/{id}/refresh` | 手动触发续期 |
| POST | `/api/account-pool/{id}/verify` | 验证该账号是否可用 |
| POST | `/api/account-pool/{id}/revive` | 复活被踢出的账号 |
| POST | `/api/account-pool/verify-all` | 全量体检 |
| DELETE | `/api/account-pool/{id}` | 删除账号 |
| GET | `/api/account-pool/events` | 拉「被踢出」「需重新扫码」事件 |

```bash
# 看池子里有几个号还活着
curl http://127.0.0.1:5200/api/account-pool/summary
```

脱敏逻辑在 `account_pool.py:864-886`：`token_preview = "abcd...wxyz"`，**永远不返回完整 token**。

### 8.11 账号池怎么用起来（实战建议）

1. **准备 3~5 个微信读书小号**（同一个人可以注册多个微信，各自登录微信读书）
2. 每个号单独扫码一次，全部进池
3. 正常跑 `collect-all`，遇到 `-2014` 会自动轮换，你什么都不用管
4. 每天看一眼 `summary`：
   - `cooldown` 多 → 降 `limit` 或加大间隔
   - `invalid` 多 → 号被风控了，`revive` 或换新号
5. **不要**为了快而把 `request_delay` 调到 0，那样只会让所有号一起进冷却

---

## 9. 正文下载：四级抗风控

> 文件：`backend/downloader.py`

### 9.1 策略总览（`downloader.py:1044-1118`）

```
① 短链规范化  →  ② 移动端 UA 直连  →  ③ 微信读书正文接口  →  ④ Playwright 无头兜底
```

### 9.2 ① 长短链规范化

```http
POST https://i.weread.qq.com/mp/getreviewid
{"urls": ["https://mp.weixin.qq.com/s?__biz=...&mid=...&idx=...&sn=..."]}
→ {"reviewIds": [{"reviewId": "MP_WXS_..._xxxx", "url": "..."}]}
```

拿到 `reviewId` 尾巴 → 拼 `https://mp.weixin.qq.com/s/{short_id}`（`downloader.py:893-906`）。

### 9.3 ② 移动端微信 UA 直连

`downloader.py:908-933`，随机挑一个真实微信版本：

```
MicroMessenger/8.0.50.2620  XWEB/1260121 MMWEBSDK/20240601
Android 14  SM-S9280  NetType/WIFI  Language/zh_CN
X-Requested-With: com.tencent.mm
```

关键是 `X-Requested-With: com.tencent.mm` —— 让服务端认为是「微信内置浏览器」打开，而非桌面爬虫。

每次请求前 `client.cookies.clear()`（`downloader.py:1073`），避免服务端种的 cookie 在多次抓取间污染。

### 9.4 ③ 微信读书正文接口（最强）

```http
GET https://weread.qq.com/web/mp/content?reviewId={reviewId}
Cookie: wr_vid=...; wr_skey=...
Referer: https://weread.qq.com/
```

只要返回的 HTML 里有 `id="js_content"` 或 `class="rich_media_content"`，就直接用（`downloader.py:953-981`）。
**这条路完全绕开 mp.weixin.qq.com 的网关风控**，是成功率最高的通道。

> 所以「账号池」不只服务于拉列表，正文下载也靠它——这是个容易忽略的耦合点。

### 9.5 ④ Playwright 无头兜底

`downloader.py:984-1041`：

- 移动端 UA + 414×896 视口
- 注入 `navigator.webdriver = undefined`
- 等 `#js_content` 出现，轻度滚动触发图片懒加载
- 渲染完再判一次风控特征

### 9.6 风控特征检测

`downloader.py:936-950`：

```python
"wappoc_appmsgcaptcha"          → 微信验证码拦截
"当前环境异常，完成验证后即可继续访问"  → 需安全验证
"你暂无权限查看此页面内容"        → 无权限
"操作频繁，请稍后再试"            → 操作频繁
```

命中任何一条 → 换下一级通道。

### 9.7 产物结构

```
articles_full/游戏研究社/S15世界赛：LPL的三年/
├── index.html        # 本地化后的正文（图片已替换为相对路径）
├── data.json         # {source,title,url,cover_url,publish_time,content}
├── metadata.json     # {title,url,time,count,leftover}
├── images/           # 本地图片
└── video/            # 本地视频
```

`leftover` = 仍指向外网的资源数量，理想值是 0。

---

## 10. 错误码手册（照着查）

| 现象 | 错误码 | 根因 | 处理 |
|---|---|---|---|
| HTTP 200 但 body 里 `errcode: -2014` | `-2014` | 微信读书瞬时频控 | 该号冷却 30s，自动换号 |
| HTTP 429 | `429` | 网关限流 | 该号冷却 60s |
| HTTP 499 | `499` | 网关中断 / 频控 | 看 body：`-2012` 重试、`-2041` 激活、`-2014` 冷却 |
| `-2012` | `-2012` | 上游网关超时 | 等 0.5s 重试一次 |
| `-2041` | `-2041` | 会话未激活 / 人机验证 | 先 `mobileSync`；仍失败 → 滑窗人工 |
| `-2013` | `-2013` | refreshToken 失效 | 必须重新扫码，标记 `refreshTokenExpired` |
| `-2001/-2002` | token 非法 | 用 refreshToken 续期 |
| 采集到 0 篇 | 无 | 该号 `mp/chapters` 全空 | 自动落 `mp/cover` 兜底 |
| 采集到但正文空 | 无 | 撞验证码 | 检查 `need_verify` / `waterwall` |

⚠️ **`need_verify: true` 或 `waterwall.active` 出现时，程序会停下来等人工过滑块**。
这是有意设计——自动过滑块属于 L4，本项目明确不实现。

---

## 11. 不启服务，纯 Python 也能跑

### 11.1 官方 CLI 路线

```bash
# 1) 先登录（会起一个本地页面让你扫码）
python3 wechat_mp_login.py

# 2) 改 wechat_mp_batch_downloader.py 顶部配置
#    TARGET_ACCOUNTS = ["游戏研究社", "手游那点事"]
#    MAX_ARTICLES    = 20
#    PAGE_SIZE       = 10

# 3) 直接跑
python3 wechat_mp_batch_downloader.py
```

它会：搜号 → 拉列表 → 存 `{name}_{fakeid}.json` → 逐篇下载 → 打印成功/失败统计。

### 11.2 直接调内部函数（适合集成到你自己项目）

```python
import sys
sys.path.insert(0, "/path/to/wechatAutoRSSTool")

from backend.accounts import search_accounts
from backend.articles import _fetch_articles_page

# 搜号
res = search_accounts("游戏研究社")
fakeid = res["list"][0]["fakeid"]

# 翻页拉列表
begin, all_articles = 0, []
while True:
    batch, total, can_continue = _fetch_articles_page(
        fakeid=fakeid, begin=begin, count=10
    )
    if not batch:
        break
    all_articles.extend(batch)
    if not can_continue or len(batch) < 10:
        break
    begin += len(batch)

print(f"共 {len(all_articles)} 篇 / 服务端说总共有 {total} 篇")
for a in all_articles[:3]:
    print(a["title"], a["link"])
```

> `_fetch_articles_page` 是下划线开头，但它是模块级函数，可以直接 import。
> 它已经内含账号池调度、频控重试、多级降级，不需要你再包一层。

---

## 12. 风控参数速查表

| 参数 | 值 | 位置 |
|---|---|---|
| 单请求最小间隔 | 0.35s + 0.05~0.18s 抖动 | `weread_signer.py:54` |
| 频控短路窗口 | 15s | `weread_signer.py:58` |
| -2014 冷却 | 30s | `account_pool.py:288` |
| 429/499 冷却 | 60s | `account_pool.py:295` |
| 连续失败踢出 | 5 次 | `account_pool.py:40` |
| 凭证保存周期 | 30 天 | `account_pool.py:38` |
| 保活检查 | 每 5 分钟 / 超 40 分钟续期 | `account_pool.py:968` |
| 列表翻页间隔 | 0.5~0.9s | `articles.py:1649` |
| 逐篇下载间隔 | 1.2~2.2s | `articles.py:1700` |
| 跨公众号间隔 | 2.0~3.5s | `articles.py:1706` |
| 单篇重试 | 3 次，退避 1→2→4s，上限 8s | `articles.py:1235-1286` |
| 列表页大小 | `min(20, max(10, limit))` | `articles.py:1616` |

---

## 13. 验收清单（怎么确认「真的采到」）

不要只看任务状态 `completed`，一定按下面 5 条核对：

- [ ] `data/account_pool.json` 里至少 1 个 `status: active`
- [ ] `curl /api/auth/status` 能看到 `vid`
- [ ] `curl "/api/articles/list/{fakeid}?begin=0&count=10"` 返回 `articles` 非空
- [ ] `data/articles_full/{公众号}/` 下有目录，且 `index.html` **体积 > 10KB**
- [ ] `index.html` 里能搜到正文关键词（不是验证码页）
- [ ] `metadata.json` 的 `leftover` 接近 0（图片都本地化了）

第 4 条是最容易翻车的：**有目录但 html 只有几 KB，基本就是抓到了风控页**。

---

## 14. 合规与边界（务必读）

1. **接口是非公开契约**。微信读书没有任何义务保持 `mp/chapters` 的稳定，随时可能改参数。
   上游项目已多次跟随改动（v2.3.7 → v2.3.8），你要有「接口变了要跟」的预期。
2. **账号池不是免死金牌**。同 IP 下多个号高频请求，会一起进风控。
   小团队内部用（3~5 个号、每天几百篇）是合理量级；做对外服务就不合适。
3. **滑块/人机验证不自动过**。命中 `-2041` 且 `mobileSync` 无效时，程序会停下来等人工。
   这是有意的安全边界，不要试图绕过。
4. **凭证只在本机**。`data/account_pool.json` 明文存 token，务必：
   - 只监听 `127.0.0.1`
   - 不进 Git（加 `.gitignore`）
   - 不打包分发
5. **仅采公开内容**。付费/需授权的文章不要采。

---

## 15. 附录：一次完整采集的调用顺序

```
1. POST /api/auth/qrcode          → 拿二维码，微信扫码
2. GET  /api/auth/status          → 轮询到 success
3. POST /api/accounts/search      → {"keyword":"游戏研究社"} → fakeid
4. POST /api/accounts             → 收藏，写入 accounts.json
5. POST /api/articles/collect-all → {"limit":20,"skip_existing":true}
6. GET  /api/articles/download-status/{task_id}   → 轮询到 completed
7. 检查 data/articles_full/{公众号}/{文章}/index.html 是否真实非空
```

全程只有第 1 步需要人工（扫码）。

---

## 16. 本文未验证的部分

| 项 | 原因 | 怎么验证 |
|---|---|---|
| 真实接口响应体 | 编写环境无法访问 `i.weread.qq.com` | 本机跑第 4~7 节 curl，对比字段名 |
| 账号池轮换的实际效果 | 需要多个真实账号 + 真实频控触发 | 用 2 个号跑 `collect-all`，看 `summary` 里 cooldown 是否轮流 |
| 无头浏览器兜底成功率 | 需要 Chromium + 真实风控页 | 故意用长链高频抓 10 篇，看是否自动切到 Playwright |
| 按日期范围翻页上限 | 取决于账号健康度 | 用一个号翻到触发 `-2014`，记录 `begin` 值 |

**上面 4 项都能在你本机 30 分钟内验证完**，验证完再决定要不要接进 wechat-loop。
