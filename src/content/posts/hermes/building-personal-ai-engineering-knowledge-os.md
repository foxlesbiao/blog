---
title: "构建个人 AI 工程知识操作系统：Hermes + OpenViking 多层记忆架构实践"
published: 2026-07-31
description: "构建个人 AI 工程知识操作系统：Hermes + OpenViking 多层记忆架构实践"
tags: ["Hermes Agent", "OpenViking", "RAG", "知识管理", "记忆系统", "工程实践", "AI Agent"]
category: "Hermes"
slug: building-personal-ai-engineering-knowledge-os
---

# 构建个人 AI 工程知识操作系统：Hermes + OpenViking 多层记忆架构实践

## 背景

我日常使用 **Hermes Agent**（Nous Research 开源）作为 AI 助手，处理系统架构设计、NAS 运维、家庭能源系统规划、代码编写等任务。但几个月下来，暴露了一个核心问题：**AI 没有长期记忆**。

每次问同一个问题，它都从零开始推理。不会记住我的设备参数、不会记住之前的决策、不会从历史经验中学习。

解决这个问题需要一套完整的**记忆架构**，而不是单一工具。这篇博客记录了过去几天的优化过程。

## 一、知识库搭建：OpenViking

### 选型

对比了几个方案：

| 方案 | 优势 | 劣势 |
|------|------|------|
| Supermemory | 自带 OCR、Gemini 提取 | 太重（PyTorch ~2GB），ARM64 慢，需自建服务 |
| knowledge-base-mcp | MCP 协议，Claude 兼容 | 同样太重（PyTorch + BGE-M3 ~4GB），ARM64 1 chunk/s |
| OpenViking | 轻量（Go 二进制），本地文件系统索引，FTS5 全文搜索 | 无 OCR，需要手动组织知识 |

最终选择 **OpenViking 0.4.11**。原因：纯 Go 编译，无 Python 依赖，在 ARM64 上跑得飞快，FTS5 搜索毫秒级响应。

### 知识分类

将知识库按领域划分：

```
viking://resources/rag/
├── engineering_control/    — 《工程控制论》上下册
├── history_politics/       — 毛选等（方法论层）
├── software_engineering/   — 《人月神话》等
└── systems_thinking/       — 《一般系统论》《系统科学方法概论》
```

核心是 **工程控制论 + 系统科学**，作为解决复杂工程问题时的知识来源。

### Hermes 集成

配置 Hermes 的 memory provider 为 OpenViking，并启用 `OPENVIKING_RECALL_RESOURCES=true`，让 Hermes 在遇到复杂问题时自动检索知识库：

```yaml
memory:
  provider: openviking
```

## 二、多层记忆架构

Hermes 的长期记忆系统设计为四层，各司其职：

```
Layer 1: SOUL.md（行为准则）
  ├── 实事求是、调查研究、矛盾分析
  ├── 系统思维、控制论、工程优先
  └── 反馈闭环、假设验证

Layer 2: Skills（怎么做）
  ├── knowledge-retrieval-evidence-policy
  ├── decision-memory
  └── 各领域专业技能

Layer 3: USER.md + MEMORY.md（事实）
  ├── 用户偏好、设备参数、环境信息
  └── 已验证的长期经验

Layer 4: OpenViking（知识 + 经验）
  ├── 工程控制论、系统科学
  ├── 软件工程、项目管理
  └── 决策记录、历史案例
```

**关键原则**：不要把知识往 SOUL.md 里堆。SOUL.md 是行为准则，不是知识库。知识归知识库，事实归 memory，做法归 skills。

## 三、知识检索策略优化

### 发现的问题

测试中暴露了一个典型错误：AI 把"三电压逆变器"理解成"48V DC + 220V AC + 电网"，但实际是**电池侧兼容 48V/60V/72V 三种电压**。

原因是：模型用通用知识推测，没有优先尊重用户 memory 中已记录的设备事实。

### 解决方案

创建 `knowledge-retrieval-evidence-policy` skill，强制以下规则：

1. **事实优先于推测** — 用户 memory 中的设备参数 > 模型通用知识
2. **未知参数必须标记** — 不允许自行补全，列出条件分支
3. **检索在推理之前** — 复杂问题先查知识库，再推理

结果：下次测试时，Hermes 正确识别了三电压逆变器的含义，并主动询问未知参数，而不是自行假设。

## 四、家庭能源系统设计

### 跨领域测试

作为知识库效果验证，设计了一套家庭能源管理系统。Hermes 在这个过程中主动调用了 OpenViking 中的工程控制论和系统科学知识，完成了跨领域综合。

### 四层架构

```
L4: 米家智能家居层 — 非关键负载控制
L3: HA 能源管理层 — 状态机、能量调度、SOC 管理
L2: 逆变器控制层 — MPPT、EPS 切换、电池检测
L1: 硬件保护层 — 断路器、SPD、熔断器（纯物理）
```

### 15 状态机

覆盖无电池、电池怠速、PV 充电、PV 自用、余电上网、电网充电、削峰放电、多级停电、换电池、故障、手动接管等场景。

### 租赁电池的特殊性

用户电池不是固定购买，而是临时租赁。这意味着系统必须支持：

- **无电池状态**：PV 自发自用，余电上网
- **电池接入检测**：自动识别 48V/60V/72V，无需 BMS 通信
- **换电池不停机**：热插拔支持

### 停电备用

电气切换由逆变器硬件 EPS 完成（<20ms），HA 负责 30s 后管理非关键负载，不承担毫秒级安全切换。

## 五、多模型路由配置

### 问题

Hermes 只有一个主模型。但日常问答、复杂架构设计、图片识别对模型能力要求不同。全部用最强模型浪费 token，全部用最便宜模型质量不够。

### 方案

利用 Hermes 的 `auxiliary` 和 `delegation` 机制，实现多模型分工：

```
                    Hermes
                       │
           DeepSeek V4 Flash（主模型）
           日常对话、RAG、工具调用、记忆管理
                       │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
       GLM-5.2      DeepSeek V4 Pro  Doubao Seed 2.0 Pro
       ─────────     ─────────────     ─────────────────
       子任务         压缩             vision_analyze
       delegate      后台审查          OCR/截图/电路图
                     策展
```

### 配置

```yaml
model:
  default: deepseek-v4-flash
  provider: custom

delegation:
  model: glm-5.2          # 子任务自动走 GLM
  provider: custom

auxiliary:
  vision:
    model: doubao-seed-2-0-pro-260215
    base_url: "https://ark.cn-beijing.volces.com/api/coding/v3"
    timeout: 120
  compression:
    model: deepseek-v4-pro   # 压缩质量优先，不丢关键约束
  background_review:
    model: deepseek-v4-pro
  curator:
    model: deepseek-v4-pro
```

**限制**：`delegation.model` 是"所有子任务固定走 GLM"，不是智能路由。Hermes 目前没有内置根据任务难度自动切换模型的能力。

## 六、清理与取舍

### 放弃的方案

过去几个月尝试过的一些路线，最终都放弃了：

| 项目 | 放弃原因 | 替代方案 |
|------|---------|---------|
| knowledge-base-mcp | PyTorch ~2GB + BGE-M3 ~2.2GB，ARM64 极慢 | OpenViking FTS5 |
| Supermemory | 同样太重，Gemini 配额限制每天 20 次 | 直接放弃，改为 OpenViking |
| lottery-agent（彩票分析） | 不再需要 | 已删除 |

### 清理命令

```bash
rm -rf ~/knowledge-base-mcp ~/kb-mcp-server
rm -rf ~/lottery-agent
```

## 七、三层系统整合

NAS、AI Agent、家庭能源系统形成三层架构：

```
Layer A: AI Agent（智能决策层）
  ├── HA API 读取能源状态
  ├── SSH 管理 NAS 服务
  ├── cron 定时任务（日报/异常检测）
  └── OpenViking 知识库

Layer B: NAS（基础设施层）
  ├── 数据存储（InfluxDB/SQLite）
  ├── Grafana 可视化
  ├── nginx 反向代理
  └── Ghost 博客

Layer C: HA 能源管理层
  ├── 状态机执行
  ├── 逆变器 Modbus 通信
  ├── 米家设备集成
  └── SOC 管理 / 负载调度
```

## 总结

### 当前状态

| 组件 | 评分 |
|------|------|
| SOUL.md（行为准则） | 8.5/10 |
| OpenViking 知识库 | 8/10 |
| 知识分类 | 8/10 |
| 知识调用策略 | 7/10 |
| 多模型路由 | 已完成 |

### 经验教训

1. **分层比堆叠重要** — 把行为准则、知识、事实、技能分开，比往一个文件里塞更多内容有效
2. **事实约束比模型能力重要** — 再强的模型，如果不尊重用户已有事实，输出也是错的
3. **轻量方案优先** — ARM64 上跑 PyTorch 是不归路，FTS5 全文搜索足够快
4. **AI Agent 需要反馈闭环** — 一次回答不够，需要设计验证、修正、迭代的机制

### 下一步

做一个 **delegate 触发规则 skill**，让 Hermes 能自动判断什么时候需要走 GLM-5.2 子任务，接近真正的多模型智能路由。