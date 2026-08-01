---
title: "Hermes 可观测 AI 系统：从规则驱动到数据驱动的工程闭环"
published: 2026-07-31
description: "Hermes 可观测 AI 系统：从规则驱动到数据驱动的工程闭环"
tags: ["Hermes Agent", "可观测性", "AI Agent", "工程系统", "架构演进", "AgentOps"]
category: "Hermes"
slug: observable-ai-system
---

# Hermes 可观测 AI 系统：从规则驱动到数据驱动的工程闭环

## 前情提要

前两篇记录了 Hermes Agent 的搭建过程：

1. **《构建个人 AI 工程知识操作系统》** —— 多层记忆架构（OpenViking + 分层记忆 + 知识检索）
2. **《Hermes 多模型路由架构》** —— 三级专家协作路由（v1→v2→v3 演化）

本篇文章是系列的第三篇，也是**阶段总结篇**。经过八小时连续的架构设计、规则编写、测试验证和故障修复，这套系统从"配置多个模型"正式进入"个人 AI 工程系统"的第三阶段——**可观测 AI 系统**。

---

## 三个阶段

```
阶段1: 工具调用 Agent
  → 能调用工具，但每次独立决策，无记忆

阶段2: 多模型 Agent
  → 多模型分工，规则路由，有记忆分层

阶段3: 可观测 AI 系统  ← 现在这里
  → 有日志，有版本，有实验，有回滚，有失败分析

阶段4: 经验驱动 AI 系统（未来）
  → 基于积累数据自动优化路由
```

---

## 本次构建的核心成果

### 1. 内存生命周期规则

解决了"记忆污染"问题——Agent 不再把旧事实当新事实，也不再不分来源地混用记忆。

**7 类可信度标记**：

| 标记 | 含义 | TTL |
|------|------|-----|
| CONFIRMED ✅ | 用户确认的事实 | 30-90 天 |
| OBSERVED 📋 | 自动探测的信息 | 30 天 |
| DERIVED 🔄 | 推理得出的结论 | 14 天 |
| SPECULATIVE ❓ | 猜测，未验证 | 1 天 |
| STALE ⌛ | 已过期 | 保留 7 天后移除 |
| CONFLICTED ⚠️ | 多个来源不一致 | 待裁决 |
| FROZEN 🧊 | 用户锁定，永不覆盖 | 永久 |

**5 类生命周期规则**：写入规则、冲突解决、过期管理、回滚机制、冷冻保护。

**冲突优先级修正**：核心原则改为"来源可信度 > 存储位置"。用户今天说的 CONFIRMED 事实，优先级高于旧 MEMORY.md 记录。不再因为"存在 MEMORY 里"就自动压过新输入。

### 2. 三层记忆职责边界

| 层 | 存储 | 职责 |
|----|------|------|
| MEMORY.md / USER.md | 高频事实 | 系统 prompt 自动注入，零延迟 |
| OpenViking | 语义知识 | 长期知识、决策、经验、架构模式 |
| FTS5 (session_search) | 原始对话 | 全文检索历史对话，兜底 |

三层的交叉检索策略：先查 MEMORY（高频事实）→ 再查 OpenViking（语义知识）→ 最后查 FTS5（原始对话）。

### 3. 真实请求 Trace 系统

建立完整链路追踪：**用户输入 → 检索 → 路由 → delegate → 模型执行 → 整合结果**

每次请求记录：
- 输入任务和复杂度评分
- 路由判断依据
- 检索来源（哪些知识库命中）
- 使用模型
- 输出结果摘要
- 用户反馈（待收集）

### 4. Task-Memory 和 Failure-Memory 观察数据库

**Task-Memory** 记录每次路由决策的完整信息：

```yaml
task_id: T6
task: 对比 MQTT vs Modbus TCP
complexity: { modules: 1, safety: true, arch: false, tradeoff: true, scale: large }
routing: { decision: Level 2, model: GLM-5.2 }
evaluation:
  latency_seconds: 102
  input_tokens: 19590
  output_tokens: 2414
  human_rating: (待收集)
```

**Failure-Memory** 记录每次失败的根本原因和修复方案：

| ID | 类型 | 原因 | 修复 |
|----|------|------|------|
| F001 | CONFIG | delegation.provider 指向不存在的 provider | 修复为 volcengine-coding-plan |
| F002 | TOOL | GLM 子任务执行过多环境探测，600s 超时 | Flash 在 delegate 前完成检索 |
| F003 | TOOL | web_search 依赖缺失，子任务花时间安装 | delegate context 预装依赖 |
| F004 | CONFIG | auxiliary.provider 同样指向不存在的 provider | 统一切换 provider |

**分类**：CONFIG / ROUTING / RETRIEVAL / MODEL / TOOL / MEMORY

### 5. Batch Test v1：6 个测试用例 × 3 个模型

| 任务 | 等级 | 模型 | 耗时 | 结果 |
|------|------|------|------|------|
| 什么是 MQTT broker | Level 0 | Flash | 0.5s | 正确路由 |
| 查 NAS IP | Level 0 | Flash | 0.5s | 正确路由 |
| 写光伏效率函数 | Level 1 | Flash | 0.5s | 正确路由 |
| 审查 HA MQTT 配置 | Level 1 | Pro | 52s | 正确路由，发现 9 项风险 |
| 设计 15 状态机 | Level 2 | GLM | 419s | 正确路由，36KB 设计文档 |
| 对比 MQTT vs Modbus | Level 2 | GLM | 102s | 正确路由，18K 字符深度分析 |

路由正确率：6/6。但样本量小，需要扩充到 20-50 个。

---

## 当前冻结的架构 v3

```
model-router v3 (frozen-baseline)
  ├── 三级路由：Level 0 (Flash) / Level 1 (Flash/Pro) / Level 2 (GLM)
  ├── 固定分工：视觉 → Doubao，审查 → Pro，压缩 → Pro
  ├── 复杂度评分维度：模块数、安全风险、架构设计、方案权衡、输出规模
  └── 用户覆盖：用户指定模型时跳过自动路由

memory-lifecycle-rules v1
  ├── 7 类可信度标记
  ├── 5 类生命周期规则
  ├── 三层记忆职责边界
  └── 冲突优先级：来源可信度 > 存储位置

task-memory / failure-memory (observation only)
  └── 不自动影响路由，仅收集数据
```

---

## 关键发现

### 1. 配置错误导致静默失败

delegation.provider 设为 "custom" 但未配置 API key，所有 delegate 任务静默失败。同样问题存在于 auxiliary.compression 和 auxiliary.curator。修复后管道畅通。

**教训**：配置必须验证，不能假设"看起来对"。

### 2. GLM 子任务执行过剩环境探测

GLM 在推理前做了 session_search、execute_code、skill_view 等 15 次探测操作，消耗了 600 秒中的大部分时间。这些应该在 Flash 阶段完成，只传递精简 context 给 GLM。

**教训**：delegate 是推理增强，不是环境探测增强。环境探测是 orchestrator 的职责。

### 3. 1000-token 阈值无数据支撑

路由规则中的 1000-token 阈值是拍脑袋的。本次 batch test 第一次收集了实际数据（T6 实际输出 22,004 tokens）。需要更多样本才能确定合理阈值。

**教训**：路由参数必须有数据支撑，不能凭感觉设。

### 4. Flash 同时作为路由器和审查者是循环依赖

当前架构中，Flash 负责判断"这是 Level 2"→ delegate 给 GLM → GLM 返回 → Flash 审查 GLM 输出。如果 Flash 无法识别 GLM 的错误，坏答案直接交付。

**v4 目标**：引入 Pro 作为独立审查者，形成 Flash → GLM → Pro → Flash 管道。

---

## 下一阶段策略

```
当前策略：
  规则驱动 > 经验驱动
  经验库只观察，不控制

下一阶段目标：
  不是让 Hermes 更聪明
  而是让 Hermes 的每一次决策都有证据、有反馈、可优化

需要积累：
  - 20-50 条真实任务 trace
  - 不同难度边界案例
  - 用户反馈质量标签
  - 模型耗时/token/成功率

v4 设计目标（暂不实现）：
  Flash = Orchestrator
  GLM = Design Expert
  Pro = Independent Reviewer
  Doubao = Vision
```

---

## 成功标准

当前阶段的成功标准不是路由更复杂，而是：

- **每一次决策都有记录**
- **每一次失败都有原因**
- **每一次改进都有依据**

这套系统现在已经从"配置多个模型"进入"个人 AI 工程系统"的阶段。下一步是收集数据，而不是继续堆规则。

---

**相关文章**：
- [构建个人 AI 工程知识操作系统](https://foxlesbiao.github.io/blog/2026/07/31/building-personal-ai-engineering-knowledge-os.html)
- [Hermes 多模型路由架构](https://foxlesbiao.github.io/blog/2026/07/31/hermes-multi-model-routing-architecture.html)