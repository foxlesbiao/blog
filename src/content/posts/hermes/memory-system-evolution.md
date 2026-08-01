---
title: "Hermes Memory System：从 MEMORY.md 到认知记忆治理层的 10 版演化"
published: 2026-08-01
description: "Hermes Memory System：从 MEMORY.md 到认知记忆治理层的 10 版演化"
tags: ["Hermes Agent", "记忆系统", "Agent Memory", "冲突解决", "知识图谱", "RAG", "架构设计"]
category: "Hermes"
slug: memory-system-evolution
---

# Hermes Memory System：从 MEMORY.md 到认知记忆治理层的 10 版演化

## 前言

这是 Hermes Agent 系列的第四篇文章。

- [第一篇：构建个人 AI 工程知识操作系统](https://foxlesbiao.github.io/blog/2026/07/31/building-personal-ai-engineering-knowledge-os.html) — 记忆分层架构
- [第二篇：多模型路由架构演化](https://foxlesbiao.github.io/blog/2026/07/31/hermes-multi-model-routing-architecture.html) — v1→v3 路由
- [第三篇：可观测 AI 系统](https://foxlesbiao.github.io/blog/2026/07/31/observable-ai-system.html) — task-memory + trace + 经验闭环
- **第四篇（本文）：Memory System v1.0→v1.41 演化** — 冲突解决 + 权限治理 + 实体图谱 + 检索引擎

本文记录 Hermes Agent 的记忆系统从简单的 MEMORY.md 文件，经过 10 个版本迭代，演化为一个带权限治理、来源链审计、时间版本、实体图谱和意图感知检索的认知记忆层的过程。

---

## 起点：为什么需要 Memory System

Hermes Agent 原来使用 MEMORY.md 存储用户事实，存在五个核心问题：

1. 无时间戳 — 无法判断过期
2. 无可信度标记 — 事实和推测混在一起
3. 无冲突解决 — 多来源矛盾时无裁决依据
4. 无过期机制 — 老旧条目永久占空间
5. 无冷冻机制 — 关键条目可能被意外覆盖

---

## 演化路线

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

---

## 核心架构（v1.41 最终状态）

### MemoryEntry 数据模型

```python
class MemoryEntry:
    value              # 内容
    memory_type        # IDENTITY / FACT / PREFERENCE / SKILL / PROJECT / TEMP
    memory_layer       # EPISODIC / SEMANTIC / PROCEDURAL / IDENTITY / TEMPORARY
    authority          # user=1.0 / tool=0.6 / agent=0.3
    source             # 来源（与 authority 分离）
    confidence         # 0.0-1.0
    explicitness       # 0.0-1.0
    freshness          # 基于 decay_days 自动衰减
    retention          # freshness×0.5 + usage×0.3 + confidence×0.2
    provenance[]       # 来源链审计（可追溯用户原始陈述）
    valid_from         # 记忆生效时间
    valid_until        # 记忆失效时间（supersede 时自动关闭）
    entity             # 实体名（如 NAS、GPU、OS）
    field              # 属性名（如 ip、model、system）
    scope              # 范围隔离（如 main_pc、laptop）
    relation           # 实体关系（如 located_at）
    target             # 关系目标（如 home_network）
    relation_confidence
    identity_status    # ACTIVE / CONFIRMED / CHANGED / ARCHIVED
    usage_count        # 被引用次数（影响 retention）
    change_reason      # 变更原因
    supersedes         # 前任 memory_id
    superseded_by      # 继任者
    conflict_with      # 冲突条目
```

### 评分公式

```
score = authority_gate × (
    0.4 × confidence
  + 0.2 × freshness
  + 0.2 × explicitness
  + 0.1 × retention
  + 0.1 × usage_frequency
)
```

authority_gate 是一个门控函数：

| 权限级别 | 权重 | gate |
|----------|------|------|
| user     | 1.0  | 1.0  |
| tool     | 0.6  | 0.7  |
| agent    | 0.3  | 0.4  |
| unknown  | 0.0  | 0.1  |

这确保了：外部信息（网页、模型推理）永远无法覆盖用户确认的事实，即使外部信息的 confidence/freshness 全部为 1.0。

### 冲突解决管道

```
用户输入
  ↓
Assertion Parser（解析断言类型）
  ├── CONFIRMED    → 明确事实
  ├── HYPOTHETICAL → 假设，不写入
  ├── UNCERTAIN    → 可能/应该/觉得
  ├── RECALL       → 我记得
  ├── QUERY        → 提问，不产生 memory
  └── REFERENCE    → 保持，不改变
  ↓
Intent Detection（是否为更新意图）
  ↓
Authority Check（权限检查）
  ├── IDENTITY 保护：非 user 权限不可修改
  └── authority_gate 评分门控
  ↓
Conflict Detection（冲突检测）
  ├── scope 隔离：main_pc vs laptop 不冲突
  ├── score 比较：新分数 > 旧分数才允许覆盖
  └── 权限门控：agent 永远无法超越 user
  ↓
Decision（决策）
  ├── supersede        → 新值替代旧值，保留历史链
  ├── supersede_frozen → 用户确认覆盖 FROZEN
  ├── flag_conflict    → 保留双方，请求用户确认
  ├── reject           → 拒绝写入
  └── no_op            → 无操作
  ↓
Memory Write（写入）
  ├── provenance 自动传播（继承旧链 + 追加新条目）
  ├── memory_layer/scope/entity 继承
  └── valid_until 自动关闭旧版本
```

### 记忆生命周期

```
ACTIVE → STALE → COMPRESSED → ARCHIVED
  ↑                        ↓
  └── TEMP 高频使用 → EPISODIC（自动升级）
```

关键设计：从不删除。TEMPORARY 如果被高频引用，自动升级为 EPISODIC。

### 意图感知检索

```python
class MemoryQueryPlanner:
    # 检测查询意图
    intents = {
        "WHOAMI":      "我是/我的"       → IDENTITY 层权重提升
        "HOWTO":       "怎么/如何/安装"   → PROCEDURAL 层权重提升
        "FACT_LOOKUP": "是什么/是多少"    → SEMANTIC 层权重提升
        "DIAGNOSE":    "为什么/报错/失败" → EPISODIC 层权重提升
        "TEMPORAL":    "什么时候/历史/之前" → EPISODIC 层权重提升
    }

    # 检索评分
    retrieval_score = (
        0.35 × keyword_match
      + 0.25 × authority
      + 0.15 × freshness
      + 0.15 × scope_match
      + 0.10 × layer_priority
    )

    # Token 预算控制
    budget = {
        IDENTITY: 1000, SEMANTIC: 3000,
        PROCEDURAL: 2000, EPISODIC: 1000, TEMPORARY: 500
    }
    # 按意图动态调整
```

---

## 关键设计决策

### 1. 来源与权限分离

信息来源（source）和修改权限（authority）是两个独立维度：

| source         | authority |
|----------------|-----------|
| 用户输入        | user      |
| FTS5 检索       | tool      |
| OpenViking     | tool      |
| 传感器          | tool      |
| 网页搜索        | agent     |
| 模型推理        | agent     |

这样设计的好处：用户提供的网址（source=web）仍然是 user 权限，不会被降级。

### 2. IDENTITY 不可变保护

IDENTITY 类型的记忆（如"用户使用 Debian"）不能被网页或模型推理覆盖。只有 user 权限的明确修改意图才能 supersede。

这防止了 Agent 最容易犯的错误：自己推理出来的信息污染用户画像。

### 3. Provenance 自动传播

每次 supersede 时，新记忆自动继承旧记忆的 provenance 链，并追加当前变更记录。调用者不传 provenance 也不会断链。

```
Arch (ACTIVE)
  ├── provenance[0]: user said "I use Debian" (2026-07-01)
  └── provenance[1]: user changed OS to Arch (2026-07-31)
```

这使 Agent 可以回答："为什么认为你使用 Arch？" → "因为你在 2026-07-31 明确说 OS 改成 Arch"。

### 4. Scope 隔离

```
GPU.model = 7650GRE  (scope=main_pc)
GPU.model = RTX3060  (scope=laptop)
```

不再冲突。`find_active(entity, field, scope)` 支持范围过滤。

### 5. 时间版本

```
Debian  valid_from=2025-01  valid_until=2026-07-31
  ↓ supersede
Arch    valid_from=2026-07-31  valid_until=NULL
```

可以回答："我什么时候开始用 Arch？" → "2026-07-31"。

### 6. Memory Layer 分类

| Layer      | 用途     | 例子               |
|------------|----------|-------------------|
| IDENTITY   | 长期身份  | 我使用 Debian 13   |
| SEMANTIC   | 事实知识  | 7650GRE 参数       |
| PROCEDURAL | 技能流程  | Docker 安装步骤    |
| EPISODIC   | 事件     | 昨天修复 grub      |
| TEMPORARY  | 短期状态  | 正在测试 OTA       |

---

## 测试验证

15 个测试案例，覆盖：

| 批次 | 案例 | 场景 |
|------|------|------|
| 第一批 A-E | 用户确认/假设/FROZEN/冲突/FTS5覆盖 | 基础冲突解决 |
| 第二批 F-J | 不确定/提问/确认/废弃/保持 | 语义压力测试 |
| 第三批 K-N | 重启恢复/示例误写入/重复确认/过期decay | 生命周期测试 |
| 第四批 O   | CONFIRMED 无 update_intent 不覆盖 FROZEN | 权限安全 |

全部 15/15 PASS。

---

## 与普通 RAG 的区别

普通 RAG：

```
文档 → Embedding → Search → Answer
```

Hermes Memory System：

```
观察
  → Assertion Parser（断言分类）
  → Authority Check（权限检查）
  → Conflict Resolver（冲突解决）
  → Ranking（评分排序）
  → Consolidation（记忆合并）
  → Entity Graph（实体图谱）
  → Intent-aware Retrieval（意图感知检索）
  → Token Budget（预算控制）
  → Context Injection（上下文注入）
  → Reasoning（推理）
```

---

## 下一阶段：v1.42 Hybrid Retrieval

v1.41 已冻结为基线。下一步不是继续堆字段，而是：

1. **Entity Normalization**（最高优先级）— "显卡" = "GPU" = "7650GRE"
2. **Hybrid Retrieval** — keyword + vector + entity graph
3. **多标签 Intent** — 一个查询可以同时是 FACT_LOOKUP + WHOAMI
4. **value_per_token** — relevance × authority × freshness ÷ token_cost
5. **模块化拆分** — 1020 行单文件拆为 memory/ 包

策略：先让 Memory System 在真实任务中运行，收集 retrieval_success / retrieval_failure 数据，用真实失败样本驱动 v1.42 迭代。

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `~/.hermes/lib/memory_conflict_resolver.py` | 核心引擎（~1020 行） |
| `~/.hermes/scripts/memory_lifecycle_v1.2_test.py` | 15 个测试案例 |
| `~/.hermes/plugins/experience-recorder/` | Hook 自动记录插件 |
| `~/.hermes/skills/meta/experience-recorder/` | 分类规则 Skill |
| `~/.hermes/skills/meta/memory-lifecycle-rules/` | 生命周期规则 Skill |
| `~/.hermes/task-memory/raw/*.jsonl` | 任务记忆原始日志 |
| `~/.hermes/failure-memory.md` | 失败记录 |
| `~/.hermes/traces/` | 完整 trace 文件 |

---

## 总结

从 v1.0 到 v1.41，Hermes Memory System 经历了：

- **v1.0**：能记东西
- **v1.2**：会生命周期管理
- **v1.3**：会排序
- **v1.37**：会混合评分（authority gate）
- **v1.39**：会时间记忆和来源审计
- **v1.41**：会意图感知检索和预算控制

已经从一个简单的 MEMORY.md 文件，演化为一个接近认知科学记忆模型的长期记忆治理层。

下一步的重点不是继续增加规则，而是让系统在真实任务中产生数据，用失败案例驱动迭代。这比理论优化更重要。
