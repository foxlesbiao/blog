---
title: "OPPO 健康云 MCP：从登录到本地 AI 分析的完整实现"
published: 2026-10-28
description: "把 OPPO 健康云数据接入 MCP：实验性账号登录、随机设备 ID、本地 SQLite 缓存、67 个健康指标的只读同步与趋势分析。"
tags: [OPPO, 欢太健康, MCP, AI Agent, Python, SQLite]
category: hermes
draft: false
---

# OPPO 健康云 MCP：从登录到本地 AI 分析的完整实现

## 这一篇写什么

之前写过[《OPPO 健康云同步逆向：从抓包到白盒签名的死局（已破）》](/posts/hermes/2026-09-18-oppo-health-cloud-reversing-whitebox-signature)。那篇的重点是逆向过程：为什么一开始被白盒签名困住，后来才发现健康云数据接口走的是更浅的静态 HMAC 签名路径。

这篇文章不再重复逆向推演，而是把破局后的结果落成可用项目：[oppo-health-cloud-mcp](https://github.com/foxlesbiao/oppo-health-cloud-mcp)。它是一个本机运行的 OPPO 健康（欢太健康）云端只读 MCP server，可以同步本人账号的数据到本地 SQLite，再让支持 MCP 的 AI 客户端查询和做周期分析。

一句话概括：

```text
欢太账号登录 / 已登录 App 凭据
        ↓
健康云只读 API
        ↓
本地 SQLite 缓存
        ↓
MCP stdio server
        ↓
AI 客户端查询 / 分析
```

## 先说边界

这个项目有几个必须先讲清楚的边界：

- 它不是 OPPO 官方 API，也没有得到 OPPO 官方授权。
- 它只做云端数据的读取和本地缓存，不提供写入、删除、修改健康数据的接口。
- 它只应该访问本人账号。健康数据非常敏感，不要拿它做多人共享服务，更不要尝试访问他人数据。
- 它服务端结构可能随 OPPO 健康 App 版本变化，项目适合作为学习和个人研究工具，而不是稳定商业服务。

还有两个常见误解：

1. **Web 端的欢太云备份不是 OPPO 健康云同步。** 前者更多是云备份页面，后者是健康 App 的系统化云端数据通道，协议和认证并不相同。
2. **OPPO 健康不一定要靠系统 App 固定身份才能用。** 登录器走的是欢太账号验证码登录，后续再换取健康包级 token；这和从已登录 App 私有文件里提取凭据是两条不同路线。

## 项目能力

当前 MCP server 暴露四个工具：

| 工具 | 说明 |
|---|---|
| `cloud_sync(metric, days=7)` | 拉取指定指标的云端数据，并写入本地 SQLite。 |
| `cloud_query(metric, date=None)` | 查询本地缓存；不指定日期时返回最近 100 条。 |
| `cloud_analyze(days=7)` | 汇总最近周期与上一周期，输出心率、血氧、步数、睡眠等趋势。 |
| `cloud_status` | 检查认证文件、缓存数据库和各指标的缓存数量。 |

项目目前覆盖 67 个 MCP 指标：65 个独立指标，加上 `stress` 和 `physical_mental` 两个组合指标。常见类别包括：

<details>
<summary><strong>查看指标分类</strong></summary>

| 类别 | 示例指标 |
|---|---|
| 心率 | `heart_rate`, `heart_rate_detail`, `heart_rate_stat`, `heart_rate_warning` |
| 血氧 | `blood_oxygen`, `blood_oxygen_detail`, `blood_oxygen_stat`, `blood_oxygen_warning`, `blood_oxygen_origin` |
| 血压 | `blood_pressure`, `blood_pressure_stat` |
| 血糖 | `blood_sugar`, `blood_sugar_stat`, `blood_sugar_warning` |
| 步数 / 运动 | `steps`, `steps_detail`, `steps_stat`, `sport_stat`, `sport_record`, `sport_goal` |
| 睡眠 | `sleep`, `sleep_stat`, `sleep_status`, `sleep_index`, `sleep_rr`, `sleep_advice` |
| HRV / 压力 | `hrv`, `stress_detail`, `stress_stat`, `stress` |
| 身心健康 | `physical_mental_detail`, `physical_mental_stat`, `physical_mental`, `physical_mental_achievement` |
| 呼吸 / 心血管 | `breath_rate`, `atrial_fibril`, `cardiovascular` |
| 腕温 / ECG | `wrist_temperature`, `wrist_temperature_detail`, `ecg` |
| 打鼾 / OSA | `snore_osa_detail`, `snore_osa_sum`, `snore_env_noise`, `snore_feature`, `sensor_osa` |
| 体重 | `weight`, `weight_target` |
| 其他记录 | `tumble`, `sedentary`, `hearing`, `cervical_stat`, `sunshine`, `vitamin` |
| 女性健康 | `physiological_cycle`, `physiological_symptoms`, `ovulation` |
| 应用使用 | `app_usage`, `app_usage_detail` |
| 健康洞察 | `insight` |

</details>

接口存在不代表账号里一定有数据。比如某项健康功能没有开启、设备不支持，或者过去没有记录，`cloud_sync` 成功但返回空集都是正常情况。另外，`wrist_temperature` 是相对个人基线的统计，不是体温计意义上的绝对体温；`sport_file` 还需要 App 运行时生成的密钥，当前项目未支持。

## 登录与认证

### 推荐路线：实验性登录器

仓库里的 `oppo_login.py` 实现了一个实验性登录器：

1. 用手机号接收验证码并完成欢太账号登录。
2. 如果服务端触发二次认证，继续要求身份证后 6 位。
3. 换取健康包级 token，并完成健康云账号登录。
4. 把 `token`、`token_auth_id`、`ssoid` 等最小认证信息写入 `auth.json`。

这条路线不需要 root，也不需要 ADB。服务端没有触发二次认证时，就不需要输入身份证信息。

登录器做了几层脱敏：

- 手机号、验证码、身份证后 6 位和 token 不回显。
- 账号刷新 token 不写入磁盘。
- `auth.json` 使用 `0600` 权限保存。

### 备用路线：从本人已登录 App 提取凭据

如果不想跑实验性登录器，也可以从本人设备上已登录的 OPPO 健康 App 私有账号文件读取凭据，再通过只读接口获取 `ssoid`。这条路需要 root/ADB，适合已经拥有本机 root 权限的用户。仓库里的认证手册写了具体步骤。

最小 `auth.json` 结构大致是：

```json
{
  "token": "...",
  "token_auth_id": "...",
  "ssoid": "..."
}
```

三个字段必须来自同一个账号。`auth.json` 等同于敏感凭据，不要提交、截图、粘贴，也不要放进公共目录。

## 设备 ID 和多账号隔离

早期方案里有一个隐患：如果多个用户复用同一组设备身份，服务端很容易把它们视为异常设备行为。现在已经改成：

```text
每次登录默认生成随机 OpenSDK device ID
同一登录内的 DUID source ID 默认与其一致
```

也就是说，普通用户不需要手工配置设备 ID。只有确实需要固定身份时，才显式传入参数或环境变量：

```bash
export OPPO_HEALTH_DEVICE_ID="<32 位 hex>"
export OPPO_HEALTH_SDK_DEVICE_ID="<32 位 hex>"
```

多账号本机隔离时，应该同时隔离认证文件和缓存数据库：

```bash
export OPPO_HEALTH_AUTH_FILE=/secure/path/account-a-auth.json
export OPPO_HEALTH_CACHE_DB=/secure/path/account-a-cache.db
```

这不等于鼓励把项目部署成多人共享服务。当前设计仍然假设“一台机器、一个用户、一套本地缓存”。

## 接入 MCP 客户端

安装依赖：

```bash
python3 -m pip install "mcp[cli]" requests pycryptodome
```

在 MCP 客户端里注册 stdio server：

```json
{
  "mcpServers": {
    "oppo-health-cloud": {
      "command": "python3",
      "args": ["/absolute/path/to/oppo-health-cloud-mcp/cloud_mcp.py"]
    }
  }
}
```

首次验证可以这样跑：

```text
cloud_status
cloud_sync(metric="steps", days=1)
cloud_query(metric="steps", date="2026-10-28")
cloud_analyze(days=7)
```

`cloud_status` 只检查本地状态；云端可用性还是要跑一次只读同步接口确认。

## 本地缓存模型

缓存文件默认是仓库目录下的 `cloud_cache.db`，主表结构很直接：

```sql
CREATE TABLE IF NOT EXISTS cloud_data(
  metric TEXT,
  date TEXT,
  payload TEXT,
  fetched_at INTEGER,
  PRIMARY KEY(metric, date)
)
```

这里做了一个取舍：

- **原始 payload 保留 JSON 字符串。** 不同健康指标的返回结构差异很大，强行拍平会导致每个指标一套表结构，维护成本高。
- **查询时再解析 JSON。** 对个人数据量来说，这个代价可以接受。
- **同一 `(metric, date)` 覆盖写入。** 重复同步不会无限膨胀。

`cloud_analyze` 基于本地缓存计算两个周期：

- 最近 N 天。
- 再往前一个 N 天。

它目前会汇总心率、血氧、步数、千卡、睡眠时长、深睡、REM 和最新体重，并给出简单异常标记。口径也会明确写进报告，例如：

- 步数和千卡按全天各模式累加。
- 睡眠在同一日有多条记录时取总时长最长的一条。
- 心率使用指定类型下的单点均值，不等价于静息心率。

## 请求与签名设计

健康云请求的核心不是“能拼出 URL”，而是保持请求形态足够接近客户端：

1. 构造规范化签名字符串。
2. 用静态应用密钥计算 HMAC 签名。
3. 保留精确的请求头集合。
4. 通过 `curl` 子进程发送请求。

这里有几个实测结论：

| 问题 | 原因 | 处理 |
|---|---|---|
| Python `urllib/requests` 被网关拦截 | TLS 指纹不符合客户端形态 | 核心请求使用 `curl` 子进程 |
| 多加请求头后签名失败 | 请求头参与签名或网关校验 | 不随意增删请求头 |
| 明细接口报时间范围错误 | 单次请求范围有限制 | 按天或版本游标分页 |
| 部分指标直接拉不到 | 服务端要求先查版本列表 | 先查版本，再按版本读详情 |

所以 `cloud_sync` 内部不是单个 HTTP 请求，而是一层适配器：按指标选择端点、展开组合指标、处理分页、归一化日期、缓存结果，再返回给 MCP 客户端。

## 为什么不用 Web 或系统备份接口

我最初的目标不是做一个“云备份爬虫”，而是让 AI 能读取本人健康数据的明细。两者需求不同：

- 云备份更偏设备资料恢复和备份管理。
- 健康云同步保存的是心率、血氧、睡眠、运动等明细，适合后续趋势分析。
- 系统 App 的本地数据库权限和私有账号文件依赖系统环境，不适合作为长期 PC 端 MCP 的基础。

因此项目最终选择健康 App 的云端只读通道，而不是 Web 备份页面或本地数据库 hook。

## 数据安全和实际风险

健康数据的敏感等级比一般网页 token 高得多。使用这个项目时，应该把两类文件都当作私密数据：

| 文件 | 内容 | 风险 |
|---|---|---|
| `auth.json` | 账号认证凭据 | 可能读取本人健康云数据 |
| `cloud_cache.db` | 本地健康数据缓存 | 可能包含心率、睡眠、位置相关运动记录、应用使用等明细 |

建议：

- 只在本机可信目录保存认证和缓存文件。
- 不要把 MCP 输出直接粘贴到公开群组或网页。
- 如果 AI 客户端会把上下文写入日志，确认你愿意让这些日志接触健康数据。
- 如果凭据泄露，尽快在欢太账号或 OPPO 健康里退出登录、修改密码，并删除本地 `auth.json` 和缓存数据库。

这也是为什么项目不适合部署成多人共享服务。它不是“一个服务端支持所有用户”的形态，而是“一个用户在本机控制自己的数据”。

## 适合的使用方式

这类工具比较适合几个场景：

1. **周期复盘**：让 AI 读取最近 7 天、30 天的数据，找趋势和异常点。
2. **本地数据整理**：把云端 JSON 收敛成个人可搜索、可分析的 SQLite 数据。
3. **跨 App 自动化**：在支持 MCP 的客户端里把健康数据和其他日记、工作、训练记录放在一起分析。
4. **设备切换后的历史分析**：只要云端仍保留数据，就不再依赖某台手机的本地数据库。

不适合的使用方式也很明确：

- 不要给陌生人代跑。
- 不要把 token 打包进镜像、容器或笔记仓库。
- 不要让 MCP server 暴露到公网。
- 不要把工具当成医疗诊断器。异常标记只是阈值提示，不能替代专业医疗判断。

## 后续方向

基础同步、查询、分析和登录已经跑通，后面我会优先做两件小事：

1. 把 `cloud_analyze` 的报告格式再收敛，让 AI 更稳定地输出“周期变化、异常点和下一步问题”，而不是把大段原始数据丢给模型。
2. 继续完善错误提示，把 token 过期、TLS 指纹拦截、时间范围超限这类常见问题解释得更清楚。

项目地址：

<https://github.com/foxlesbiao/oppo-health-cloud-mcp>

如果你想看签名为什么一开始被误判成“死局”，可以先读上一篇文章；如果你只想让 AI 读取自己的 OPPO 健康数据，直接从这个仓库的 README 开始就可以。
