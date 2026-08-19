---
title: "OPPO 健康数据导出：LSPosed 逆向 + MCP 规范化接入 AI"
published: 2026-08-19
tags: [LSPosed, MCP, Android逆向, 数据导出, AI]
category: hermes
draft: false
---

# OPPO 健康数据导出：LSPosed 逆向 + MCP 规范化接入 AI

## 问题

想把自己 OPPO 健康（心率 / 睡眠 / 血氧 / 呼吸率等）的**全部明细数据**交给本地 AI 深度分析，而不是只看 App 里的聚合图表。但 OPPO 健康的本地数据库是 **SQLCipher 加密**的，直接打开是乱码，拿不到数据。

同时，导出的数据要喂给 AI agent 分析，接收端接口如果写得不够规范，别人（其它 agent）没法按标准接入。所以最后把服务端做成了 **MCP (Model Context Protocol)** 规范。

完整代码已开源：github.com/foxlesbiao/oppo-health-export

## 三层方案

```
手机(LSPosed hook) ──增量导出──▶ 服务端 Flask(手机专通道) ──▶ sink库 ──▶ MCP server
  提取SQLCipher密钥                                   (行哈希幂等)      │
  流式分片 + 分块上传                                                     ▼
                                                                 任意 AI agent
```

### 第 1 层：手机端 LSPosed 逆向拿密钥

- OPPO 健康的库用 SQLCipher 加密，密钥链最终落在 Android Keystore。
- 写 LSPosed 模块 hook 它的加解密类，拿到解密密钥就能打开整个库。
- **用 libxposed 新 API**（`io.github.libxposed.api.XposedModule`），旧 `de.robv.android.xposed` 已停更，千万别用。
- hook 要点：
  - `AesGcmAndroidKeyStore.b()` 抓解密后的密钥
  - `bj4.a(Context)` 拿单例密钥
  - **不要在 onPackageLoaded 里直接反射调目标方法**（静态初始化没就绪会崩 App），要 hook `Activity.onCreate` 后延迟几秒再“虚拟打开”数据库。
- 密钥格式：`32位十六进制 + "db_key"` 后缀。

### 第 2 层：增量导出（行业标准做法）

一开始 `SELECT * FROM 全表` 直接全量读进内存，在手机上直接 **OOM**（一张运动明细表单次分配 400+MB）。按数据工程的标准做法改成：

- **流式分片**：每表 `WHERE 时间戳 > 水位 ORDER BY 时间戳 LIMIT 2000` 循环分批写，绝不整表进内存。
- **水位（cursor）**：服务端存各表上次同步到的最大时间戳，手机每次只导新增。首次设**初始水位 90 天**建基线，不回溯全历史。
- **分块多次上传**：每导满 2 万行就 POST 一个分块，单包几 MB、失败只重试该块、手机内存恒定。
- **幂等**：服务端给每行算 `__row_hash`（SHA-256）做 UNIQUE，`INSERT OR IGNORE`，重复上传自动去重。

### 第 3 层：服务端做成 MCP 规范

自定义 Flask API 不规范，对外开放给别的 agent 时按 **MCP** 暴露，用 `FastMCP` 写成一个独立 server（纯 mcp + sqlite3，不依赖 Flask），暴露 6 个标准工具：

| 工具 | 功能 |
|---|---|
| `health_ingest` | 接收增量分节数据（幂等入库 + 更新水位） |
| `health_watermark` | 查询各表水位（增量游标） |
| `health_list_tables` / `health_stats` | 列出表 / 统计概览 |
| `health_query` | 按时间 / 列查询已入库数据 |
| `health_schema` | 表结构 |

任何 AI agent / MCP 客户端注册这个 server 就能拿到 `mcp__oppo_health__health_query` 等工具，直接查健康数据。

数据分节格式：
```
===TABLE:DBHeartRate|TIMECOL:data_created_timestamp===
ssoid,device_type,data_created_timestamp,value,...
1249250120,,1779393420000,85,...
```

## 踩过的坑

| 坑 | 修复 |
|---|---|
| 全量 SELECT 进内存 OOM | 流式分片（LIMIT 2000/批） |
| hook 多入口多线程重复导出，CPU 500%+ | `AtomicBoolean` 单实例互斥 |
| 首次全历史几百万行极慢 | 初始水位取近 90 天 |
| SQL 注入（表名 / 列名拼进 SQL） | 标识符白名单校验 + 全参数化 |
| 数据库跨连接写锁 | SQLite WAL + busy_timeout |
| 软重启 `stop;start` 停死 system_server | 统一用完整 `adb reboot` |

## 有了数据 ≠ 能解读：还需要医学知识库

导出的只是**原始指标**（心率、血氧、睡眠时长、呼吸率……）——它们本身是无医学含义的数字。要**准确**分析、而不是让模型凭内置的泛泛知识臆断，还必须给 agent 接入靠谱的**医学知识库**：

- 把权威资料（医学教材、临床指南、中医典籍）入库（RAG / 向量检索）
- 分析时**先检索、再下结论**，并标注「这个判断依据哪份资料」
- 缺少对应资料时**明确说不知道**，而不是编一个看似合理的解读

这才是工程上负责任的健康分析：数据链路负责「绝对真实的你」，知识库负责「尽量正确的解读」，两者缺一不可。否则再精确的数据，也可能被一句想当然的解读带偏。

### 而且：可穿戴数据只是「参考级」

别忘了，输入给 AI 的只是**消费级可穿戴设备（手环/手表）的估算值**——心率、血氧、睡眠算法都有误差，**只能作为参考**，不能替代或作为临床诊断依据。真正权威的健康判断要靠**日常体检/医院检查**（生化、影像等）来决定。这套数据智能的价值在于「帮你发现趋势、提醒你何时该去医院」，而不是「替你下诊断」。

### 别被单位坑了（分析必知）

OPPO 健康库里部分字段**不是直觉单位**，分析时最容易算错：

| 字段 | 原始单位 | 换算 |
|---|---|---|
| 体重 weight | 克 | ÷1000 = kg |
| 睡眠 total_sleep_time | 分钟 | 分钟 |
| 卡路里 | 卡(cal) | ÷1000 = kcal |
| 呼吸率 value | 0.1 次/分 | ÷10 ≈ 12 次/分 |
| 时间戳 | 毫秒 | ÷1000 = 秒 |

### 隐私与安全

这套链路的数据**从头到尾只在你自己手里**：

- 手机 → 自家服务，内网直连；出门走 **Tailscale**（零暴露面，不把 80/443 暴露公网）
- sink 库、AI 分析（本地知识库 OpenViking）、生成报告全部在本地
- **不经过任何第三方云 / 服务器**

### 自动化闭环

新数据上传即自动分析，不用手动跑：

```
手机上传(/api/upload) → HMAC 签名的本地 webhook → agent 读新数据生成周报告
   → 写入本地知识库(OpenViking) → 推送到 IM
```

数据一进来就被消费，形成「导出一分析一归档」的闭环。

### 分析示例：这些是跑出来的真实数据

聚合自 sink 库（近 90 天增量，去敏后仅保留统计值）：

| 指标 | 真实结果 |
|---|---|
| 睡眠时长（平均） | **7.5 小时 / 晚**（80 晚有效记录） |
| 中位入睡 / 醒来 | **02:07 / 07:28**（近 30 天，与 App 一致） |
| 深睡 | 1.1 小时 |
| REM（快速眼动） | 1.9 小时 |
| 每日光照（平均） | **44 分钟**（健康目标 20 分钟） |
| 光照达标率 | 44%（54 天中 24 天达标） |

> 光照/户外是 OPPO 健康里很有价值的维度（对应维生素 D、昼夜节律）；达标题直接映射设备设定的「每日光照目标」。

### 实测结论：为什么不做「免 root」分发

常有朋友问：能不能把模块**内置进 APK、免 root**给普通人用？我实测了 **LSPatch** 方案，结论是**此路不通**，记录如下省得后人重复踩坑：

- **静态 OK**：LSPatch 能顺利把 dbkeyhook 模块内置进 OPPO 健康 APK 并重打包（该 App **未加固**）。
- **真机安装 ❌**：报错 `INSTALL_FAILED_SHARED_USER_INCOMPATIBLE: oplus named app is not match signature`。
- **根因**：OPPO 健康是 **ColorOS 平台签名共享 uid（`android:sharedUserId="oplus"`）** 的系统应用，只接受带平台签名的同 uid 安装；LSPatch 重签名后 uid 签名不匹配，系统直接拒绝。
- **因此免 root 绕不开**：要 hook 它，只能是 **KernelSU/Magisk + LSPosed** 这条真 root 路径（即本仓库模块的默认用法）。

> 给想「免 root 分发 hook 模块」的人一条排查捷径：先看目标 App 的 manifest 有没有 `android:sharedUserId`——只要命中了厂商系统 uid（如 `oplus`、`miui`、`huawei` 之类），LSPatch 重签名立刻报废，别浪费时间。

> **测试环境说明**：以上 hook 模块仅在 **一加 13T（OPPO/ColorOS ROM）及 OPPO 设备**上验证过；其他品牌 / 型号 / ROM 未实测，不能保证兼容，自行安装风险自负。

## 总结

- **逆向层的核心**：libxposed 新 API + 钩对加解密类拿密钥 + 延迟虚拟打开，避免早期反射崩 App。
- **导出层的核心**：不追求一次回溯全历史，设初始水位 → 首次导近期 → 之后增量；分片保证内存峰值恒定。
- **接收层的核心**：做标准 MCP server 而非自造 API，别人能按规范接入。

这样你的健康数据就能持续、增量、幂等地流进本地 AI，且对外是标准 MCP 接口。

代码：github.com/foxlesbiao/oppo-health-export
