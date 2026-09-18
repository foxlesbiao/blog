---
title: "OPPO 健康云同步逆向：从抓包到白盒签名的死局"
published: 2026-09-18
tags: [逆向, Android, 安全区]
category: hermes
draft: false
---

# OPPO 健康云同步逆向：从抓包到白盒签名的死局

## 背景

我有一个长期项目：把 OPPO 健康（欢太健康）App 里的心率/HRV/血氧/睡眠等数据自动导出到本地做分析。已有方案是 root + LSPosed hook 本地数据库，稳定跑着。

新想法很自然：**云同步里既然有全部数据，能不能直接抓云端的接口，做一个纯 PC 的 MCP？** 这样使用者只需要抓一次 cookie，不用 root、不用 LSPosed、App 升级也不用改 hook。

结论先说：**思路验证成立，但被白盒签名封死在最后一步。** 下面是完整的调查过程，给同样想走这条路的人省时间。

## 第一步：静态分析 APK —— 云端存的是明细

反编译健康 App（脱敏版本号 6.9.x），找到云同步的 API 网关（域名脱敏为 `***.heytapmobi.com/sporthealth/`），共 667 个 `v1-v5/c2s/*` 端点。关键事实：

**云端存的是明细数据，不是聚合值。** 每类指标都有独立同步接口：

| 指标 | 接口模式 | 响应数据 |
|---|---|---|
| 血氧 | pull 明细 | 值+时间戳+设备ID 数组 |
| 步数 | pull 明细 | 分段 steps/distance/calories/sportMode |
| 心率 | syncStat 日聚合 | max/min/avg/rest/sleepBase |
| 睡眠 | 版本增量 | 睡眠指数（含 spo2/呼吸/心率/入睡时间） |
| 血糖/压力/腕温/久坐/日晒/跌倒 | pull 明细 | 全通 |

增量协议也确认了：`queryXxxVersion(水位) → modifiedTimestampList → 按版本拉数据`，标准的双向增量同步（push 上传 + pull 下载），App 卸载重装恢复数据靠的就是它。

鉴权比预想的轻：请求头一个 `virtual-ssoid` 就够，账号 token 走 accountsdk。没有多层签名链——**当时我以为这条路能通。**

## 第二步：抓包 —— 认证体系完整还原

真机 Reqable 抓包，1296 条请求（1084 条健康 API），303 个不同端点。认证头全部识别：

| 头 | 来源 |
|---|---|
| token（`ACCESS_` 开头，753 次复用同一值） | accountsdk |
| token-auth-id | = usercenter.db 的 deviceId 列 |
| appid / app-key-version | 固定值 |
| nonce + timestamp + **signature** | 每请求唯一 ← 问题所在 |

前四个都是静态的，抓一次包就有。唯一的变数是 signature——每条请求都不一样。

## 第三步：smali 逆向 —— 签名协议 100% 还原

顺 `SignInterceptor` 挖下去，签名链完整还原：

```
HttpSignData{method, url, body, 10个签名头}
  → V2Signer.getCommonSignHeaders()
  → SecKitClient.macSign(context, bytes)   ← libwbkit-seckit3.so 白盒
  → signature header
```

签名构造算法本身是可复刻的：

```
canonical = method\n + path\n + query\n + 排序headers\n + signedHeaders\n + sha256(body)
sig = HmacSHA256(mk, canonical) → CMSSignedData protobuf → base64
```

问题在密钥 `mk` 的来源：

```
服务端 KMS 协商下发
  getkmssystemtime → getkmscertificate → getserviceticket
  → ServiceSessionInfo{Dek, Mk, Ticket}
```

**死锁**：初始 `getserviceticket` 协商请求本身需要 `accessKey + WbkitAndr.signature`（白盒 native 签名）。即：

> 要拿到会话密钥 mk，得先通过白盒签名认证；要白盒签名，得在真机上跑那个 so。

## 第四步：实验 —— 实测封死纯 PC 路线

理论推完还不算完，直接做实验验证（之前的 403 结论用错了 token 类型，不算数，这次重测）：

| 实验 | 结果 |
|---|---|
| HAR 原始请求**原样重放**（同 token/sig/nonce/body，间隔几分钟） | 403 `10103` |
| 去掉 signature | 403 同上 |
| 伪造 signature + 新 nonce | 403 同上 |
| 按 smali 还原的 canonical 格式，用所有静态头组合当 HMAC 密钥穷举 | 全不中 |

两组实验锁死事实链：

1. 原样重放都被拒 → nonce 有时效/一次性，网关验的不只是静态凭证
2. HMAC 密钥用客户端一切静态值都凑不出 → 密钥就是协商下发的 `mk`
3. 协商要白盒 native 签名 → 死循环闭合

**本质是信息的物理分布问题**：签名密钥那 32 字节此刻只存在于两个地方——服务端 KMS 数据库里，和真机内存里（用完即弃的会话态）。它不在 APK 里、不在抓包文件里、不在任何静态文件里。这不是"AI 不够聪明"，是白盒密码的设计目标就是防提取。

## 行业方案盘点

白盒签名怎么破，业界工具箱其实很固定：

| 方案 | 原理 | 本案可行性 |
|---|---|---|
| unidbg 离线模拟 | Java/unicorn 模拟 so，黑盒调 macSign | 企业级 SDK 带 Context/KeyStore 依赖，成功率 <30%，工作量 1-2 周 |
| Frida RPC 签名代理 | 手机 hook macSign 暴露 RPC，PC 发请求前过手机签名 | **可行**，半天工作量，但要手机在线 |
| Xposed 常驻签名服务 | 模块内起 localhost HTTP 包 macSign | 可行且比 Frida 稳，但要维护模块 |
| 静态还原白盒算法 | IDA/Ghidra 啃 so | 不现实，白盒设计目标就是防这个 |

淘宝 x-sign 这类能被 unidbg 破的前提是"纯算法 so"；一旦签名密钥走服务端协商（本案），静态路线全灭。**行业共识：动态调用是标准答案。**

## 总结

1. **云同步数据方案没有死，但"抓 cookie 就能用"死**。最短可行路径是 Frida RPC 签名桥：PC 发请求 → 手机（连 Wi-Fi 充电即可）出签名 → 云端拉数据。依赖等级 = 手机在线，和原 hook 方案持平。
2. **原 hook 方案仍是依赖最少的形态**。数据管道已经全自动跑着，云抓取的真正价值只有"换机/重装免配置"，收益配不上新增的签名服务复杂度——所以这个方向收档了。
3. **方法论收获**：403 结论下早了会误导方向（第一次测试 token 类型就是错的）；重放实验+密钥穷举这种"否定性实验"比正向尝试更有信息量——两组实验直接闭合了死循环的证明链。密码学死锁面前，逆向工程的终点是确认"这条路的门是焊死的"，然后换路。

签名对拍样本已留存（740 条），哪天重启这个方向，5 分钟捡起来。
