---
title: "给 AI agent 做一个 Steam MCP：48 个工具与踩穿的三个坑"
published: 2026-11-26
tags: [MCP, Steam, AI-Agent, 逆向工程, Python]
category: hermes
draft: false
---

# 给 AI agent 做一个 Steam MCP：48 个工具与踩穿的三个坑

## 缘起

我需要一个能被 AI agent 直接调用的 Steam。

不是"把网页按钮搬进 MCP"那种——是要能让 agent 自己回答这些问题：

- 我愿望单里哪些在打折，哪个最值得现在买？
- 这个 87% 折扣是真的低点，还是假促销？
- 库里的游戏哪些装了从来没打开过？
- 这件饰品在 Steam 市场和第三方平台差多少？

市面上现成的 Steam MCP 大多是壳：查个档案、搜个游戏就完了。写操作（加愿望单、加购物车、结账）几乎没人做，因为登录态这块太难缠。

结果这东西做到了 **48 个工具**，覆盖账号、库、商店、市场、分析、跨平台比价。过程中踩穿的三个坑，比功能本身有意思。

仓库：[foxlesbiao/steam-mcp](https://github.com/foxlesbiao/steam-mcp)

## 坑一：续期永远失败，而且错误信息在骗你

### 症状

登录能用，几小时后失效。调静默续期：

```json
{
  "ok": false,
  "error": "refresh_rejected",
  "message": "续期链路跑完但会话仍无效（refresh token 通常只能用一次，可能已被消费）。"
}
```

提示说"token 只能用一次，被消费了"。于是重登、再等、再失效、再重登——循环。

### 误判

一开始真的信了这个提示，去做"refresh token 轮换"的改造：每次续期成功就存下新 token。

但 `rotated_refresh_token: false` —— 从来没换到过新 token。说明根本不是"消费"问题。

### 真因（两个叠在一起）

**其一：cookie 值被 unquote 解码了。**

`steamRefresh_steam` 的值形如：

```
7656119xxxxxxxxxx%7C%7CeyAidHlwIjogIkpXVCIs...
```

`%7C%7C` 就是 `||` 的 URL 编码。代码在存 cookie 时顺手 `unquote()` 了一下——这是处理 cookie 的常见习惯，在这里是致命的：

| | 长度 | 含 `%` |
|---|---|---|
| 浏览器里的值 | 508 | 2 |
| 代码存进去的值 | 504 | 0 |

解了码的值发回 Steam，服务端不认。**cookie 一律原样存、原样发，别碰。**

**其二：`finalizelogin` 的 nonce 传错了东西。**

Steam 的网页续期链路里有两个都叫 "nonce" 的东西：

1. `/jwt/ajaxrefresh` 用 refresh token 换回来的**一次性 transfer nonce**
2. `finalizelogin` 需要的 **refresh JWT 本身**

直觉会认为"先 ajaxrefresh 拿 nonce，再拿去 finalize"。错。把 ajaxrefresh 返回的 nonce 传给 finalizelogin，稳定拿到：

```json
{"success": false, "step": "jwt lookup", "error": 8}
```

`error 8` 是 `InvalidParam`。这一步的报错太模糊，很容易被理解成"token 无效/被消费"——正好呼应了那句骗人的提示。

正确做法（从 [node-steam-session](https://github.com/DoctorMcKay/node-steam-session) 的源码里翻出来的）：

```python
# steamRefresh_steam = "<steamid>%7C%7C<jwt>"
jwt = unquote(cookie_value).split("||", 1)[1]   # 取后半段

# finalizelogin 的 nonce 就是这个 jwt
POST /jwt/finalizelogin  {nonce: jwt, sessionid, redir}
    Content-Type: multipart/form-data
    Origin: https://steamcommunity.com
    Referer: https://steamcommunity.com/
```

改完立刻拿到 `transfer_info`，逐域 settoken 把 `steamLoginSecure` 全收回来，`checkout_ready` 从 `false` 变 `true`。

### 验证方法

只看一次成功不算数。**连续跑两次续期**，两次都成功且 refresh cookie 长度不变，才说明这是"可反复签"，不是"抢救式续一次"。

## 坑二：购物车加不进去，而且不报错

### 症状

```
POST /cart/addtocart?redirect=1
→ 302 → https://store.steampowered.com/cart/
```

HTTP 层面完美。打开购物车，空的。

换游戏、重登、换会话，全一样。

### 排错走过的弯路

1. **怀疑年龄门槛**——换了全年龄游戏，还是失败。
2. **怀疑风控冷却**——等半小时，没变。
3. **怀疑登录态残缺**——重登了一次（用户手机确认的那种），依然失败。
4. **拿匿名会话做对照**——匿名加车**成功**。

第 4 步才是关键：匿名能加，登录账号加不了，说明端点和参数都没问题，问题在账号侧的状态。

### 真因

翻自己之前留下的尸体：有一笔 `finalize` 失败的交易。

那次是因为我先手动调了 `price` 核价，再调 `finalize`——而 finalize 内部会**再核一次价**，同一个 transid 第二次核价被 Steam 拒绝：

> getfinalprice 对同一 transid 只成功一次

于是那笔交易停在"未完成"状态，**把整个购物车锁住了**。之后所有加车请求都返回 302，但不会真的写入。

修法一行：

```
steam_checkout(action="cancel", transid="<那笔没完成的>")
```

加车立刻恢复。

### 顺带修掉的两个解析 bug

**其一：购物车页判空判错了。**

新版购物车是 React SSR，且页面里**恒有一个"购物车是空的"空状态组件文案**。用 `"购物车是空的" in html` 判空，有货时也是 True。

**其二：双层转义解析不到行项目。**

行项目藏在 JSON 字符串内部，多一层转义：

```
\"line_item_id\":\"5326109652\",\"item_id\":{\"packageid\":423337}
```

结构化的递归解析在这层反斜杠上断了。改用正则在原文里抓，稳。

修完后 `steam_cart(action="add")` 能返回 `verified: true` + 真实的 `line_item_id`。

## 坑三：SteamDB 想都别想，但它有合规替代

原本想要"历史最低价"，第一反应是 SteamDB。

实测：

```
GET https://steamdb.info/app/730/                          → 403
GET https://steamdb.info/api/GetPriceHistory/?appid=730    → 403
```

带着完整浏览器 UA 也一样。Cloudflare 之后还有站点条款明文禁止抓取，官方 API 要付费 key。

**403 不是能绕过的问题，是信号：这条路本来就该换。**

换成 [IsThereAnyDeal](https://isthereanydeal.com/)：官方免费 key，1000 次 / 5 分钟，直接给历史最低价 + 折扣 + 出现时间点。

```python
# appid → ITAD UUID
GET /games/lookup/v1?appid=730&key=...

# 历史最低（注意是 POST，body 直接是字符串数组）
POST /games/historylow/v1?key=...&country=ID
     ["018d937f-5b12-7380-a77e-8754efb603d0"]
```

拿到结果后，顺手核了一下当天的三笔订单：

| 游戏 | 历史最低 | 折扣 | 出现在 | 实付 | 结论 |
|---|---|---|---|---|---|
| FF7 REMAKE INTERGRADE | 104,220 | -82% | Epic | 104,220 | 正好史低 |
| 火线迈阿密 2 | 19,580 | -85% | GOG | 19,649 | 贵 0.35% |
| 底特律 化身为人 | 36,999 | -90% | Epic | 39,900 | 贵 7.8% |

有个必须讲清的差别：**ITAD 的"历史最低"跨全部商店**。上面三个底价两个在 Epic、一个在 GOG，都不在 Steam 上。想等真史低就得接受在别家下单；只玩 Steam 库，那看的就是 Steam 自己的底价。

## 设计上的取舍：什么不做

工具数量不是目标，所以有几块明确砍掉：

| 不做 | 理由 |
|---|---|
| 市场交易（上架/改价/撤单/接报价） | 每笔都要手机确认，程序化等于把 2FA 私钥交出去。只读挂单已经够用 |
| 通知 | 页面是 React SSR 片段，44KB 里没有稳定结构，解析写出来就是定时炸弹 |
| 本地客户端层（装了哪些/占多少盘/启动游戏） | 数据在另一台装了 Steam 的 Windows 上，MCP 跑在 Linux。跨机部署的维护成本大于收益 |

反过来，有几件事是"agent 专用"必须做的：

1. **每个工具返回结构化数据 + `error` 码 + `hint`**，不抛裸异常。agent 看不到堆栈，只能看字段。
2. **写操作分级标注**：description 前缀 `[只读]` / `[写入]` / `[花钱]`，让模型选工具时不至于误触。
3. **批量任务给进度而不是卡死**：愿望单折扣扫描受 0.4s/条的限速约束，348 条约 2 分钟——工具返回 `{scanned, remaining, has_more}`，让调用方决定要不要继续，而不是一次调用等到超时。
4. **离线可测**：纯解析逻辑全部用 mock 数据覆盖，不联网就能跑。5 个测试文件，60+ 断言。

## 最终形态

48 个工具，分六块：

| 块 | 代表工具 |
|---|---|
| 账号 | 密码/cookie 登录、Steam Guard、静默续期 |
| 数据 | 档案、好友、库、成就、库存、新闻、评测 |
| 商店 | 搜索、详情、愿望单读写、购物车、结账 |
| 市场 | 行情、我的挂单（只读）、Steam vs BUFF 比价 |
| 分析 | 游玩时长、折扣雷达、Deck 兼容、库对比、价格快照 |
| 历史 | 购买记录、IsThereAnyDeal 历史低价 |

有意思的是最后那批"分析"工具——它们不新增任何网络端点，纯粹是把已有数据重新组合。但问 agent"我库里哪些游戏买了没玩"时，只有它们能回答。

**做 MCP 的性价比拐点不在"能调多少接口"，而在"能不能让 agent 自己得出结论"。**

---

相关：

- 仓库：[foxlesbiao/steam-mcp](https://github.com/foxlesbiao/steam-mcp)
- 续期实现参考：[node-steam-session](https://github.com/DoctorMcKay/node-steam-session)
- 历史低价数据：[IsThereAnyDeal API](https://docs.isthereanydeal.com/)
