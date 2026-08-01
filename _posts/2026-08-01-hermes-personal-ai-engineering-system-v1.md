---
layout: post
title: "Hermes 个人 AI 工程系统 v1.0：从零搭建到可观测认知架构的完整记录"
date: 2026-08-01
tags: [Hermes Agent, AI Agent, 工程系统, 架构设计, 记忆系统, 模型路由, 可观测性, v1.0]
lang: zh-CN
---

# Hermes 个人 AI 工程系统 v1.0

> 这不是一篇配置教程，而是一个关于**如何让 AI 记住你、理解你、并越用越聪明**的工程记录。

## 前言

我日常使用 Hermes Agent 处理系统架构设计、NAS 运维、家庭能源系统规划、代码编写等任务。但几个月下来，暴露了一个核心问题：**AI 没有长期记忆**。每次问同一个问题，它都从零开始推理。不会记住我的设备参数，不会记住之前的决策，不会从历史经验中学习。

解决这个问题需要一套完整的**工程系统**，而不是单一工具。经过连续多日的迭代，这套系统从"配置多个模型"正式进入 v1.0 阶段。

本文是对四篇系列文章的完整整合，一次性呈现这套系统的全貌。

---

## 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│                    Hermes 个人 AI 工程系统 v1.0               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Layer 1: 行为准则 (SOUL.md)                         │   │
│  │  实事求是、调查研究、矛盾分析、系统思维、控制论        │   │
│  │  反馈闭环、假设验证、工程优先                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Layer 2: 专业技能 (Skills)                          │   │
│  │  knowledge-retrieval-evidence-policy                 │   │
│  │  decision-memory / model-router v3                   │   │
│  │  memory-lifecycle-rules / experience-recorder        │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Layer 3: 持久事实 (MEMORY.md + USER.md)             │   │
│  │  用户偏好、设备参数、环境信息、已验证的长期经验        │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Layer 4: 知识库 (OpenViking)                        │   │
│  │  resources: 工程控制论/系统科学/软件工程/方法论       │   │
│  │  memories: 决策记录/历史案例/架构模式                │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Layer 5: 多模型路由 (Model Router)                  │   │
│  │  Flash(主控制器) + Pro(审查) + GLM(专家) + Doubao(视觉)│   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Layer 6: 可观测性 (Observability)                   │   │
│  │  task-memory / failure-memory / trace / batch test  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 第一章：为什么需要记忆系统

### 起点

Hermes Agent 原本只靠 MEMORY.md 存储用户事实，存在五个核心问题：

| 问题 | 后果 |
|------|------|
| 无时间戳 | 无法判断过期 |
| 无可信度标记 | 事实和推测混在一起 |
| 无冲突解决 | 多来源矛盾时无裁决依据 |
| 无过期机制 | 老旧条目永久占空间 |
| 无冷冻机制 | 关键条目可能被意外覆盖 |

### 关键问题：AI 没有长期记忆

举一个典型例子：测试中 AI 把"三电压逆变器"理解成"48V DC + 220V AC + 电网"，但实际是**电池侧兼容 48V/60V/72V 三种电压**。原因是模型用通用知识推测，没有优先尊重用户 memory 中已记录的设备事实。

这说明：**再强的模型，如果不尊重用户已有事实，输出也是错的。**

---

## 第二章：知识库搭建（OpenViking）

### 选型对比

| 方案 | 优势 | 劣势 |
|------|------|------|
| Supermemory | 自带 OCR、Gemini 提取 | 太重（PyTorch ~2GB），ARM64 慢 |
| knowledge-base-mcp | MCP 协议，Claude 兼容 | 同样太重，ARM64 1 chunk/s |
| **OpenViking 0.4.11** | 轻量 Go 二进制，FTS5 全文搜索，ARM64 飞快 | 无 OCR，需手动组织知识 |

最终选择 OpenViking。纯 Go 编译，无 Python 依赖，在 ARM64 上毫秒级响应。

### 知识分类

```
viking://resources/rag/
├── engineering_control/    — 《工程控制论》上下册
├── history_politics/       — 毛选等（方法论层）
├── software_engineering/   — 《人月神话》等
└── systems_thinking/       — 《一般系统论》《系统科学方法概论》
```

### 知识检索策略

创建 `knowledge-retrieval-evidence-policy` skill，强制规则：

1. **事实优先于推测** — 用户 memory 中的设备参数 > 模型通用知识
2. **未知参数必须标记** — 不允许自行补全，列出条件分支
3. **检索在推理之前** — 复杂问题先查知识库，再推理

优先级链：

```
当前用户明确提供的事实 > 用户已验证的长期事实 > 当前环境实际检测结果
> 官方文档与可靠资料 > 知识库专业知识 > 一般经验 > 推测与假设
```

---

## 第三章：记忆系统从 v1.0 到 v1.41 的演化

### 演化路线

```
v1.0  能记东西
 ↓
v1.1  会冲突检测
 ↓
v1.2  会生命周期管理（持久化 + decay）
 ↓
v1.3  会排序（Memory Ranking Engine）
 ↓
v1.35 会权限和实体（authority + entity/field）
 ↓
v1.36 会不可变保护（IMMUTABLE_TYPES）
 ↓
v1.37 会混合评分（authority_gate × 加权和）
 ↓
v1.38 会来源审计（provenance + scope 隔离）
 ↓
v1.39 会时间记忆（valid_from/until + memory_layer）
 ↓
v1.40 会检索（Query Planner + GC + EntityGraph）
 ↓
v1.41 会意图感知 + 预算管理（Intent Detection + Budget）
```

### v1.41 核心架构

**MemoryEntry 数据模型** — 20+ 维度，包括：value、entity、field、scope、authority、confidence、provenance、valid_from/until、memory_layer、identity_status 等。

**评分公式**：

```
score = authority_gate × (
    0.4 × confidence
  + 0.2 × freshness
  + 0.2 × explicitness
  + 0.1 × retention
  + 0.1 × usage_frequency
)
```

**权限门控**：

| 权限级别 | 权重 | gate |
|----------|------|------|
| user | 1.0 | 1.0 |
| tool | 0.6 | 0.7 |
| agent | 0.3 | 0.4 |
| unknown | 0.0 | 0.1 |

外部信息（网页、模型推理）永远无法覆盖用户确认的事实。

**冲突解决管道**：用户输入 → Assertion Parser（CONFIRMED/HYPOTHETICAL/UNCERTAIN/RECALL/QUERY/REFERENCE）→ Intent Detection → Authority Check → Conflict Detection → Decision（supersede/flag_conflict/reject）→ Memory Write

**记忆生命周期**：ACTIVE → STALE → COMPRESSED → ARCHIVED。从不删除，TEMPORARY 高频使用自动升级为 EPISODIC。

**意图感知检索**：根据查询意图（WHOAMI/HOWTO/FACT_LOOKUP/DIAGNOSE/TEMPORAL）动态调整各记忆层权重，以匹配度 × 权限 × 新鲜度 × 范围匹配 × 层优先级 综合评分。

### 关键设计决策

1. **来源与权限分离** — 信息来源（source）和修改权限（authority）是两个独立维度。用户提供的网址（source=web）仍然是 user 权限，不会被降级。
2. **IDENTITY 不可变保护** — 用户身份/偏好不能被网页或模型推理覆盖。
3. **Provenance 自动传播** — 每次 supersede 自动继承旧链并追加新记录。
4. **Scope 隔离** — main_pc 和 laptop 的同属性不同值不冲突。
5. **时间版本** — 每次变更保留 valid_from/valid_until 历史链。

### 测试验证

15 个测试案例，覆盖基础冲突解决、语义压力测试、生命周期测试、权限安全测试，全部 15/15 PASS。

---

## 第四章：多模型路由架构

### 问题

Hermes 只有一个主模型，但日常问答、复杂架构设计、图片识别对模型能力要求不同。

### 可用模型池

| 模型 | 角色 | 资源等级 |
|------|------|---------|
| DeepSeek V4 Flash | 主模型 + Router + 整合者 | 快速 |
| DeepSeek V4 Pro | 审查 + 增强 | 增强 |
| GLM-5.2 | 深度推理专家 | 深度 |
| Doubao Seed 2.0 Pro | 视觉 | 专用 |

### 架构演化（v1 → v2 → v3）

**v1（关键词触发）**：看到"架构"→ delegate，看到"状态机"→ delegate。问题：误触发，过拟合。

**v2（三级任务分级）**：Level 0（Flash）→ Level 1（Flash+Pro）→ Level 2（GLM）。改进：从关键词升级为按复杂度分级。遗留：GLM 直接输出给用户，无用户覆盖。

**v3（三级路由 + 专家回流 + 用户覆盖）** — 当前冻结版本：

```
                User Request
                     │
                     ▼
          DeepSeek V4 Flash
          Router + Orchestrator
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
     Level 0      Level 1      Level 2
     Flash       Flash+Pro      GLM-5.2
        │            │            │
        │            │            │
        ▼            ▼            ▼
    简单任务      审查增强      专家设计
                     │
                     ▼
              Flash 整合输出
```

**核心规则**：
1. GLM 是专家，不直接面对用户，输出必须回流 Flash 验证+整合
2. 用户明确指定模型时覆盖自动路由
3. 先查 OpenViking 知识库，再决定是否 delegate
4. 预估 <1000 tokens 且无架构/安全需求时不 delegate
5. 资源等级替代成本等级（避免 API Plan 价格变化导致错误）

### 完整决策树

```
Step 1: 用户指定了模型？ → 尊重用户选择
Step 2: 包含图片？ → Doubao Vision（自动）
Step 3: 有 OpenViking 知识？ → 先检索
Step 4: 复杂度评估
Step 5: 路由（Level 0/1/2）
```

### 配置实现

```yaml
model:
  default: deepseek-v4-flash
  provider: custom

delegation:
  model: glm-5.2
  provider: custom

auxiliary:
  vision:
    model: doubao-seed-2-0-pro-260215
    base_url: "https://ark.cn-beijing.volces.com/api/coding/v3"
    timeout: 120
  compression:
    model: deepseek-v4-pro
  background_review:
    model: deepseek-v4-pro
  curator:
    model: deepseek-v4-pro
```

---

## 第五章：可观测 AI 系统

### 三个阶段

```
阶段1: 工具调用 Agent → 能调用工具，但每次独立决策，无记忆
阶段2: 多模型 Agent → 多模型分工，规则路由，有记忆分层
阶段3: 可观测 AI 系统 → 有日志，有版本，有实验，有回滚，有失败分析
阶段4: 经验驱动 AI 系统（未来）→ 基于积累数据自动优化路由
```

### 内存生命周期规则

7 类可信度标记：

| 标记 | 含义 | TTL |
|------|------|-----|
| CONFIRMED ✅ | 用户确认的事实 | 30-90 天 |
| OBSERVED 📋 | 自动探测的信息 | 30 天 |
| DERIVED 🔄 | 推理得出的结论 | 14 天 |
| SPECULATIVE ❓ | 猜测，未验证 | 1 天 |
| STALE ⌛ | 已过期 | 保留 7 天后移除 |
| CONFLICTED ⚠️ | 多个来源不一致 | 待裁决 |
| FROZEN 🧊 | 用户锁定，永不覆盖 | 永久 |

冲突优先级：**来源可信度 > 存储位置**。用户今天说的 CONFIRMED 事实，优先级高于旧 MEMORY.md 记录。

### 三层记忆职责边界

| 层 | 存储 | 职责 |
|----|------|------|
| MEMORY.md / USER.md | 高频事实 | 系统 prompt 自动注入，零延迟 |
| OpenViking | 语义知识 | 长期知识、决策、经验、架构模式 |
| FTS5 (session_search) | 原始对话 | 全文检索历史对话，兜底 |

交叉检索策略：先查 MEMORY → 再查 OpenViking → 最后查 FTS5。

### Task-Memory 和 Failure-Memory

**Task-Memory** 记录每次路由决策的完整信息：任务类型、复杂度评分、路由判断、使用模型、耗时、token、结果摘要。

**Failure-Memory** 记录每次失败的根本原因和修复方案：

| ID | 类型 | 原因 | 修复 |
|----|------|------|------|
| F001 | CONFIG | delegation.provider 指向不存在的 provider | 修复为 volcengine-coding-plan |
| F002 | TOOL | GLM 子任务执行过多环境探测，600s 超时 | Flash 在 delegate 前完成检索 |
| F003 | TOOL | web_search 依赖缺失，子任务花时间安装 | delegate context 预装依赖 |
| F004 | CONFIG | auxiliary.provider 同样指向不存在的 provider | 统一切换 provider |

### Batch Test v1

| 任务 | 等级 | 模型 | 耗时 | 结果 |
|------|------|------|------|------|
| 什么是 MQTT broker | Level 0 | Flash | 0.5s | 正确路由 |
| 查 NAS IP | Level 0 | Flash | 0.5s | 正确路由 |
| 写光伏效率函数 | Level 1 | Flash | 0.5s | 正确路由 |
| 审查 HA MQTT 配置 | Level 1 | Pro | 52s | 正确路由，发现 9 项风险 |
| 设计 15 状态机 | Level 2 | GLM | 419s | 正确路由，36KB 设计文档 |
| 对比 MQTT vs Modbus | Level 2 | GLM | 102s | 正确路由，18K 字符深度分析 |

路由正确率：6/6。样本量小，需扩充到 20-50。

### 关键发现

1. **配置错误导致静默失败** — delegation.provider 未配置 API key，所有 delegate 任务静默失败
2. **GLM 子任务执行过剩环境探测** — 600 秒中大部分时间花在 session_search、execute_code 等环境探测上
3. **1000-token 阈值无数据支撑** — 拍脑袋的，需要更多样本
4. **Flash 同时作为路由器和审查者是循环依赖** — v4 目标：引入 Pro 作为独立审查者

---

## 第六章：经验教训

### 架构原则

1. **分层比堆叠重要** — 把行为准则、知识、事实、技能分开，比往一个文件里塞更多内容有效
2. **事实约束比模型能力重要** — 再强的模型，如果不尊重用户已有事实，输出也是错的
3. **轻量方案优先** — ARM64 上跑 PyTorch 是不归路，FTS5 全文搜索足够快
4. **AI Agent 需要反馈闭环** — 一次回答不够，需要设计验证、修正、迭代的机制

### 路由设计教训

1. **不要用关键词触发路由** — 容易误触发，趋向过拟合
2. **Flash 是大脑，不是最低级模型** — 它负责判断和整合，不是替代品
3. **GLM 不直接面对用户** — 专家输出必须经过主模型验证和整合
4. **成本等级不要硬编码** — 不同 API Plan 价格不同，用资源等级替代
5. **先查知识库再 delegate** — 充分利用已有知识，避免不必要的专家调用
6. **规则路由是起点，经验路由是终点** — 先跑数据，再做自适应

---

## 第七章：当前状态与下一阶段

### v1.0 冻结清单

```
model-router v3 (frozen-baseline)
  ├── 三级路由：Level 0 (Flash) / Level 1 (Flash/Pro) / Level 2 (GLM)
  ├── 固定分工：视觉 → Doubao，审查 → Pro，压缩 → Pro
  └── 用户覆盖：用户指定模型时跳过自动路由

memory-lifecycle-rules v1
  ├── 7 类可信度标记
  ├── 5 类生命周期规则
  ├── 三层记忆职责边界
  └── 冲突优先级：来源可信度 > 存储位置

memory_conflict_resolver v1.41
  ├── ~1020 行 Python 核心引擎
  ├── 15/15 测试通过
  ├── 意图感知检索 + Token 预算控制
  └── 冻结，等待真实数据驱动迭代

task-memory / failure-memory (observation only)
  └── 不自动影响路由，仅收集数据

experience-recorder (Python plugin)
  └── hook 自动触发，不依赖模型遵守规则
```

### 4 个观察指标

| 指标 | 目标 | 说明 |
|------|------|------|
| 路由准确率 | 逐步提升 | 任务→路由→结果质量评分 |
| GLM 调用比例 | 5-15% | 超过 30% 说明 Router 太激进 |
| 升级失败案例 | 重点收集 | Flash 不足→用户追问→GLM 解决的案例 |
| 决策稳定性 | 同类任务一致 | 避免同类型任务反复切换模型 |

### 理想模型分配

```
Flash:  70-85%
Pro:    10-20%
GLM:     5-15%
Doubao: 按需
```

### 下一阶段方向

**v1.42 Memory System**（不急着写，先收集真实数据）：
1. Entity Normalization（最高优先级）— "显卡" = "GPU" = "7650GRE"
2. Hybrid Retrieval — keyword + vector + entity graph
3. 多标签 Intent
4. value_per_token budget
5. 模块化拆分（1020 行单文件拆为 memory/ 包）

**v4 路由**（暂不实现）：
- Flash = Orchestrator
- GLM = Design Expert
- Pro = Independent Reviewer
- Doubao = Vision
- 经验驱动路由替代规则驱动

---

### 文件清单

| 文件 | 说明 |
|------|------|
| `~/.hermes/lib/memory_conflict_resolver.py` | 核心引擎（~1020 行） |
| `~/.hermes/scripts/memory_lifecycle_v1.2_test.py` | 15 个测试案例 |
| `~/.hermes/plugins/experience-recorder/` | Hook 自动记录插件 |
| `~/.hermes/skills/meta/model-router/` | 三级路由规则 |
| `~/.hermes/skills/meta/experience-recorder/` | 分类规则 Skill |
| `~/.hermes/skills/meta/memory-lifecycle-rules/` | 生命周期规则 Skill |
| `~/.hermes/skills/meta/knowledge-retrieval-evidence-policy/` | 事实约束规则 |
| `~/.hermes/task-memory/raw/*.jsonl` | 任务记忆原始日志 |
| `~/.hermes/failure-memory.md` | 失败记录 |
| `~/.hermes/traces/` | 完整 trace 文件 |

---

## 结语

这套系统现在已经从"配置多个模型"进入"个人 AI 工程系统"的阶段。

当前阶段的成功标准不是路由更复杂，而是：

- **每一次决策都有记录**
- **每一次失败都有原因**
- **每一次改进都有依据**

下一步的重点不是继续增加规则，而是让系统在真实任务中产生数据，用失败案例驱动迭代。这比理论优化更重要。

**已从"配置 AI"进入"培养 AI"阶段。**