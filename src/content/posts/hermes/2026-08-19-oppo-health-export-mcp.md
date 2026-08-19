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

## 总结

- **逆向层的核心**：libxposed 新 API + 钩对加解密类拿密钥 + 延迟虚拟打开，避免早期反射崩 App。
- **导出层的核心**：不追求一次回溯全历史，设初始水位 → 首次导近期 → 之后增量；分片保证内存峰值恒定。
- **接收层的核心**：做标准 MCP server 而非自造 API，别人能按规范接入。

这样你的健康数据就能持续、增量、幂等地流进本地 AI，且对外是标准 MCP 接口。

代码：github.com/foxlesbiao/oppo-health-export
