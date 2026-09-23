---
title: "控制 OpenViking Memory Extraction：从源码定位到精准管控"
published: 2026-08-02
tags: [Hermes, OpenViking, Memory, Source Code Analysis]
category: hermes
draft: true
---

# 控制 OpenViking Memory Extraction：从源码定位到精准管控

## 问题

Hermes + OpenViking 的记忆系统存在一个隐蔽问题：大量低价值临时信息（API key 状态、cron job ID、一次性操作日志）被自动写入长期记忆，污染了记忆库。

表现为 `viking://user/memories/` 里充斥着：

```
"GF VPN日报 cron (53bb)"
"API key状态(2026-08-02)"
"Energy system archit"
```

这些不该进长期记忆。

## 诊断过程

### 第一层：定位调用链

翻 Hermes 的 OpenViking 插件源码（`plugins/memory/openviking/__init__.py`，4692行），找到完整的记忆写入链路：

```
对话
 ↓
sync_turn()          # 每轮对话记录消息
  → POST /api/v1/sessions/{sid}/messages
 ↓
on_session_end()     # session 结束
  → _commit_session()
    → POST /api/v1/sessions/{sid}/commit
      body: {"keep_recent_count": 0}
      → 服务端自动提取 6 类记忆
        profile / preferences / entities / events / cases / patterns
 ↓
存入 viking://user/memories/
```

### 第二层：发现根因

关键发现：**提取在 OpenViking 服务端，不在插件里。**

- 插件只负责发消息和 commit
- commit 触发服务端自动提取
- 服务端默认提取全部 6 类记忆，**没有任何过滤**

之前在 `~/.hermes/lib/` 里写的 `MemoryConflictResolver`（v1.41 记忆治理系统）完全被绕过——调用链根本不经过它。

### 第三层：找到控制开关

继续翻 OpenViking 服务端源码，在 `session/memory_policy.py` 找到 `MemoryPolicy` 结构：

```python
@dataclass
class MemoryPolicy:
    self_enabled: bool = True
    peer_enabled: bool = True
    memory_types: Optional[set[str]] = None  # None = 全部，可限定子集
    working_memory_enabled: bool = True
```

`memory_policy` 在 **创建 session 时** 传入，commit 时不可更改。

插件 `initialize()` 创建 session 时 **没传** `memory_policy`，所以服务端用默认值 = 全部启用 = 激进提取。

## 方案

### 策略选择

| memory_type | 保留 | 理由 |
|-------------|------|------|
| profile | ✅ | 用户身份、硬件配置、开发环境 — IDENTITY 层 |
| preferences | ✅ | 工作习惯、回答偏好、技术路线 — 长期用户模型 |
| entities | ✅ | 设备、服务、项目实体 — EntityGraph 数据源 |
| events | ❌ | "昨天测试OTA"、"今天改配置" — 一次性垃圾 |
| cases | ❌ | 某次故障、某次排错 — EPISODIC 应由 Hermes 控制 |
| patterns | ❌ | 不是合法类型（服务端会报 `Unknown memory_type`） |

最终配置：

```python
_MEMORY_POLICY_PAYLOAD = {
    "self": {"enabled": True},
    "peer": {"enabled": True},
    "memory_types": ["profile", "preferences", "entities"],
    "working_memory": {"enabled": True},
}
```

### 代码修改

修改文件：`~/.hermes/hermes-agent/plugins/memory/openviking/__init__.py`

**新增方法** `_apply_memory_policy()`：在 session 创建时传入 memory_policy。

**三个调用点：**

1. `initialize()` — 插件初始化时
2. `_ensure_client_locked()` — 连接恢复时（处理 OV 启动比 Hermes 慢的情况）
3. `sync_turn()` — **在发消息之前** 调用（解决时序竞争）

### 踩坑：时序竞争

最隐蔽的一个问题。最初的实现只在 `initialize()` 和 `_ensure_client_locked()` 里调 `_apply_memory_policy`，但验证时发现 policy 始终为 None。

原因：`sync_turn()` 恢复连接后，紧接着 POST 消息到 `/api/v1/sessions/{sid}/messages`，服务端 **自动创建 session**（无 policy）。`_apply_memory_policy` 虽然被调了，但 session 已存在，走了 debug 路径跳过。

```
时序：
  _ensure_client()          → _apply_memory_policy() → session 已存在? 跳过
  sync_turn POST messages   → 服务端自动创建 session（无 policy）
```

修复：把 `_apply_memory_policy` 调用移到 `sync_turn()` 里，在 `_ensure_client()` 之后、POST messages **之前**：

```python
def sync_turn(self, ...):
    if not self._ensure_client():
        return

    # 在发消息之前确保 session 带正确的 policy
    effective_sid = str(session_id or self._session_id or "").strip()
    if effective_sid and effective_sid not in self._policy_applied_sessions:
        self._apply_memory_policy(effective_sid)
        self._policy_applied_sessions.add(effective_sid)

    # 然后才发消息
    ...
```

用 `_policy_applied_sessions` 集合做去重，避免每轮都调。

### 踩坑：OpenViking systemd 启动失败

OV 的 systemd 服务缺少 `WorkingDirectory`，配置里的 `workspace: "./data"` 相对路径被解析到 `/data`，权限拒绝，导致 OV 反复重启（counter 296 次）。

修复：

```ini
[Service]
WorkingDirectory=/home/oect
```

### 踩坑：patterns 不是合法类型

用户建议保留 `patterns`，但服务端返回 `Unknown memory_policy.memory_types: patterns`。实际可用的只有 5 个：`profile`、`preferences`、`entities`、`events`、`cases`。

## 验证

```bash
# 创建带 policy 的 session
curl -X POST http://127.0.0.1:1933/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test","memory_policy":{"self":{"enabled":true},"peer":{"enabled":true},"memory_types":["profile","preferences","entities"],"working_memory":{"enabled":true}}}'

# 查询确认
curl http://127.0.0.1:1933/api/v1/sessions/test
```

Hermes 日志确认：

```
INFO plugins.memory.openviking: OpenViking session 20260802_112606_76c27ddb created with memory_policy: ['profile', 'preferences', 'entities']
```

API 查询确认：

```json
{
  "memory_policy": {
    "self": {"enabled": true},
    "peer": {"enabled": true},
    "memory_types": ["entities", "preferences", "profile"]
  }
}
```

## 架构变化

### 之前

```
对话 → sync_turn → commit → 服务端全量提取（6类）→ 大量垃圾记忆
                                          ↑ 无过滤
```

### 现在

```
对话 → sync_turn → [创建session带policy] → commit → 只提取3类
                                   ↓
                          profile / preferences / entities
                                   ↓
                          viking://user/memories/
```

### 后续路线

```
v1.42 (当前): 限制 extraction 范围 — 总闸已关
v1.43: HermesMemoryGate — 接管 viking_remember 工具的写入过滤
v1.44: Hybrid Retrieval — v1.41 ConflictResolver 接入检索链路
```

核心思路：**先关总闸减少污染，再逐步接入 Hermes 自己的记忆治理层。** 不是清理垃圾，而是从源头控制不产生垃圾。

## 总结

| 问题 | 根因 | 修复 |
|------|------|------|
| 垃圾记忆过多 | 服务端默认提取全部6类 | 限制为3类 |
| policy 不生效 | 时序竞争，session 被消息POST先创建 | sync_turn 里发消息前先创建 session |
| OV 启动失败 | systemd 缺 WorkingDirectory | 加 `WorkingDirectory=/home/oect` |
| patterns 无效 | 不是合法 memory_type | 去掉，只用5个合法类型 |

关键经验：**改源码前先通读完整调用链**。最初的修改只改了 `initialize()`，验证失败后才发现 `sync_turn` 的时序竞争。每一层障碍都是在实际验证中暴露的，不是靠看代码就能预见的。
