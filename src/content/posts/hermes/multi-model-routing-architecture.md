---
title: "Hermes 多模型路由架构：从单模型到三级专家协作的演化之路"
published: 2026-07-31
description: "Hermes 多模型路由架构：从单模型到三级专家协作的演化之路"
tags: ["Hermes Agent", "模型路由", "AI Agent", "多模型", "架构设计", "工程实践", "MoE"]
category: "Hermes"
slug: multi-model-routing-architecture
---

# Hermes 多模型路由架构：从单模型到三级专家协作的演化之路

## 背景

在上一篇《构建个人 AI 工程知识操作系统》中，我记录了 Hermes Agent 多层记忆架构的搭建过程。但解决了"记住什么"之后，下一个问题是——**"用什么模型来思考"**。

日常对话、RAG 检索、简单脚本用 Flash 就够，但系统架构设计、硬件安全分析、多方案权衡需要更强的推理能力。全部用最强模型浪费 token，全部用最便宜模型质量不够。

本文记录从单模型到多模型路由的完整演化过程。

## 问题定义

### 可用模型池

| 模型 | 能力特征 | 资源消耗 |
|------|---------|---------|
| DeepSeek V4 Flash | 快速响应，工具调用稳定 | 低 |
| DeepSeek V4 Pro | 代码能力中等，适合审查 | 中 |
| GLM-5.2 | 深度推理，架构设计强 | 高 |
| Doubao Seed 2.0 Pro | 视觉理解，OCR | 专用 |

### 核心矛盾

- **单一模型无法同时兼顾**速度、成本、复杂推理质量
- Hermes 没有内置"根据任务难度自动切换模型"的能力
- 主模型只能有一个，但任务类型多种多样

### 设计目标

1. 简单任务不浪费 GLM
2. 复杂任务 Flash 能判断出来交给专家
3. 视觉不走主模型
4. 用户明确指定时覆盖自动路由
5. 路由决策可追溯、可优化

## 架构演化

### v1：关键词触发（跳过）

第一版简单粗暴——用关键词匹配判断是否 delegate：

```
看到"架构" → delegate
看到"状态机" → delegate
看到"电路图" → delegate
```

**问题**：
- 用户问"什么是状态机？"也会误触发
- 简单问题被升级，浪费 token
- 规则越来越复杂，趋向过拟合

### v2：三级任务分级

将任务分为三个等级：

| 等级 | 描述 | 路由目标 |
|------|------|---------|
| Level 0 | 单步问答、查询、配置 | Flash 直接回答 |
| Level 1 | 需要分析，不需要重新设计系统 | Flash 或 Pro |
| Level 2 | 系统设计、架构、多方案权衡 | delegate → GLM-5.2 |

**改进**：从"关键词触发"升级为"按复杂度分级"，误触发减少。

**遗留问题**：
- GLM 直接输出给用户，没有经过 Flash 验证
- 没有用户覆盖机制
- 成本等级标注不准确（不同 API Plan 价格不同）

### v3：三级路由 + 专家回流 + 用户覆盖（当前版本）

最终架构：

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

#### 核心改进 1：GLM 输出回流

GLM 是专家，不直接面对用户。

```
Flash
  ↓
delegate_task → GLM-5.2（深度推理）
  ↓
GLM 结果返回 Flash
  ↓
Flash 职责：
  ├── 验证结果合理性
  ├── 合并 memory 上下文（用户偏好、设备参数）
  ├── 检查已知/未知约束
  ├── 补充 OpenViking 知识
  └── 输出最终答案给用户
```

#### 核心改进 2：用户覆盖

如果用户明确指定模型，**始终尊重**，跳过路由判断。

```
"用 GLM-5.2 分析这个架构" → 走 GLM
"用 DeepSeek Pro 审查代码"  → 走 Pro
```

#### 核心改进 3：资源等级替代成本等级

避免不同 API Plan 下价格标注不准确：

| 模型 | 资源等级 |
|------|---------|
| Flash | 快速 |
| Pro | 增强 |
| GLM | 深度 |

#### 核心改进 4：RAG 优先

先查 OpenViking 知识库，再决定是否 delegate。

```
问题
  ↓
有 OpenViking 知识可用？
  ↓ YES → 先检索，看能否直接回答
  ↓ NO  → 继续复杂度判断
```

#### 核心改进 5：Token 预算判断

delegate 前先预估：

```
如果预计回答 < 1000 tokens
  AND 无架构设计
  AND 无多方案比较
  AND 无硬件安全
→ 不要 delegate，Flash 足够
```

## 完整路由决策树

```
Step 1: 用户指定了模型？
  YES → 尊重用户选择，跳过路由

Step 2: 包含图片？
  YES → Doubao Vision（自动，无需操作）

Step 3: 有 OpenViking 知识可用？
  YES → 先检索，看能否直接回答

Step 4: 复杂度评估
  预计回答长度、模块数、是否含方案比较、
  是否涉及硬件安全、是否需要架构图

Step 5: 路由
  Level 0 → Flash 直接回答
  Level 1 → Flash 或 Pro（代码审查走 Pro）
  Level 2 → delegate → GLM-5.2 → 回流 Flash 整合
```

## 辅助链（自动路由，无需操作）

```
图片/截图/OCR
        │
        ▼
Doubao Seed 2.0 Pro

后台任务（压缩、策展、background_review）
        │
        ▼
DeepSeek V4 Pro
```

## 为什么 Flash 是"大脑"而不是"最低级模型"

很多多模型方案的结构是：

```
便宜模型 → 判断 → 贵模型
```

这种方案的问题：便宜模型判断不准，路由错误率高。

我们的方案：

```
Flash → 理解上下文 → 决定是否调用专家 → 整合输出
```

Flash 不是"便宜替代品"，而是**主控制器**。它负责：
- 理解用户完整意图
- 调用 memory 和知识库
- 判断是否需要专家介入
- 整合专家输出为最终答案

## 配置实现

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
    model: deepseek-v4-pro
  background_review:
    model: deepseek-v4-pro
  curator:
    model: deepseek-v4-pro
```

## 当前状态：冻结 v3，进入数据收集

现在不做更多规则调整，让真实使用数据跑出来。

### 4 个观察指标

| 指标 | 目标 | 说明 |
|------|------|------|
| 路由准确率 | 逐步提升 | 任务→路由→结果质量评分 |
| GLM 调用比例 | 5-15% | 超过 30% 说明 Router 太激进 |
| 升级失败案例 | 重点收集 | Flash 不足→用户追问→GLM 解决的案例 |
| 决策稳定性 | 同类任务一致 | 避免同类型任务反复切换模型 |

### 理想分配

```
Flash:  70-85%
Pro:    10-20%
GLM:     5-15%
Doubao: 按需
```

## 未来方向

### v4.1：task-memory（经验驱动路由）

记录每次路由决策的效果，积累经验数据：

```
task-memory/
├── energy/EMS设计
│     ├── model: GLM-5.2
│     ├── success: true
│     └── pattern: state-machine
├── software/docker迁移
│     ├── model: Flash
│     └── success: true
└── hardware/BMS分析
      ├── model: GLM-5.2
      └── success: true
```

以后遇到类似任务，直接查询历史，自动选择最佳模型。

### v4.2：failure-memory（失败升级）

Flash 尝试解决 → 检测到多次工具失败/不确定性 → 自动升级到 GLM。

### 最终形态

```
                  Hermes
                    │
             Model Router
                    │
        ┌───────────┼───────────┐
     Rules       Memory       Feedback
       │            │             │
   当前规则     历史决策      成功率
        └───────────┼───────────┘
                    ▼
            自适应模型选择
```

## 架构模式总结

当前 Hermes 已经形成 4 层知识体系：

| 层级 | 内容 | 回答的问题 |
|------|------|-----------|
| Resource Memory | 专业知识库 | "这个领域有什么知识？" |
| Event/Experience Memory | 历史经验 | "以前发生过什么？" |
| Decision Memory | 设计决策 | "为什么选择这个方案？" |
| Pattern Memory | 架构模式 | "以后类似问题怎么处理？" |

模型链形成 **Planner → Specialist → Reviewer → Integrator** 结构：

```
创造能力 = GLM-5.2
执行能力 = DeepSeek V4 Flash
审查能力 = DeepSeek V4 Pro
经验能力 = OpenViking
```

## 经验教训

1. **不要用关键词触发路由** — 容易误触发，趋向过拟合
2. **Flash 是大脑，不是最低级模型** — 它负责判断和整合，不是替代品
3. **GLM 不直接面对用户** — 专家输出必须经过主模型验证和整合
4. **成本等级不要硬编码** — 不同 API Plan 价格不同，用资源等级替代
5. **先查知识库再 delegate** — 充分利用已有知识，避免不必要的专家调用
6. **规则路由是起点，经验路由是终点** — 先跑数据，再做自适应

## 关联阅读

- [构建个人 AI 工程知识操作系统：Hermes + OpenViking 多层记忆架构实践](/blog/2026/07/31/building-personal-ai-engineering-knowledge-os.html) — 记忆架构搭建
- model-router skill：`~/.hermes/skills/meta/model-router/SKILL.md`
- 决策记录：OpenViking `viking://user/memories/events/`