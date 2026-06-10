---
layout: post
title: "SQLite FTS5 跨架构迁移踩坑记：从 x86 到 ARM64"
date: 2026-06-10
tags: [SQLite, FTS5, ARM64, 迁移, Armbian, Hermes Agent]
lang: zh-CN
---

# SQLite FTS5 跨架构迁移踩坑记：从 x86 到 ARM64

## 背景

最近将 **Hermes Agent**（一个基于 SQLite 的 AI 聊天代理）从一台 x86_64 Arch Linux 服务器迁移到一台 ARM64 Armbian 开发板上。数据量不大：约 111MB 的 `state.db`，包含 9786 条消息、186 个会话。

迁移数据库嘛，听起来很简单对吧？然而这次踩了一个大坑。

## 迁移方案的选择

### 方案一：`.dump` / `.reload`（我选的，后来证明是错的）

```bash
# 在源机器上导出
sqlite3 state.db ".dump" > dump.sql

# 在目标机器上导入
sqlite3 state.db < dump.sql
```

看起来很标准对吧？SQLite 官方文档也推荐这个方法来做版本升级或格式转换。但问题是——**当数据库包含 FTS5 虚拟表时，这个方法有严重的隐患。**

### 方案二：直接复制 `.db` 文件（正确方案）

```bash
# 直接拷贝
scp user@source-server:/path/to/state.db ./state.db
```

没错，就这么简单。**SQLite 的 `.db` 文件是二进制跨架构兼容的**——x86 和 ARM64 使用相同的字节序（小端），SQLite 文件格式不依赖任何平台特定的结构。直接复制就行。

## 问题现象

使用 `.dump` / `.reload` 导入后，数据库看起来正常，表和数据都在。但当 Agent 尝试写入新消息时：

```
RuntimeError: constraint failed
```

具体报错指向 FTS5 虚拟表的插入操作。进一步测试：

```sql
-- 查询没问题
SELECT COUNT(*) FROM messages;  -- 9786，正常

-- 插入就报错
INSERT INTO messages (session_id, role, content, timestamp)
VALUES ('test', 'user', 'hello', datetime('now'));
-- Error: constraint failed
```

## 诊断过程

### 1. 标准完整性检查——没用

```sql
PRAGMA integrity_check;
-- ok
```

`PRAGMA integrity_check` 返回正常！但它**不会检查 FTS5 shadow 表的完整性**。这是一个容易被忽略的坑。

### 2. FTS5 专用完整性检查——发现问题

FTS5 提供了内置的完整性检查命令：

```sql
SELECT * FROM messages_fts('integrity-check');
```

- 如果 FTS5 索引完好，这条语句返回**空结果集**
- 如果索引损坏，会返回错误描述

在我的案例中，它返回了不一致的错误信息，确认 FTS5 索引已损坏。

### 3. 检查 shadow 表

FTS5 虚拟表会在底层创建一组 "shadow 表"（以 `_data`、`_idx`、`_content`、`_docsize`、`_config` 为后缀）。你可以直接查看：

```sql
-- 查看有哪些 shadow 表
SELECT name FROM sqlite_master
WHERE type='table' AND name LIKE 'messages_%';
```

这些表的状态在 dump/reload 后可能不一致。

## 根因分析

**问题出在 `.dump` 导出的 SQL 语句顺序上。**

`.dump` 会导出：
1. `CREATE VIRTUAL TABLE messages_fts USING fts5(...)` — 创建 FTS5 表
2. 各种 `INSERT` 语句填充主表
3. 可能还有触发器（用于自动同步主表和 FTS5 索引）

但在 reload 时，触发器可能会在插入主表时**同时触发 FTS5 索引更新**，而这些更新与后续的 shadow 表数据发生冲突。在不同架构间，SQLite 内部的某些排序或序列化行为可能有微小差异，进一步加剧了这种不一致。

另外还发现 `sqlite_sequence` 表的值严重异常——autoincrement 计数器显示约 3 万亿，而实际只有不到 15000 行。这也是 dump/reload 过程中的副作用。

## 修复方案

### 完整修复脚本

以下是一个通用的 FTS5 索引修复脚本：

```bash
#!/usr/bin/env bash
# repair_fts.sh - 修复 FTS5 索引
# 用法: bash repair_fts.sh <数据库路径> <FTS表名> <主表名> <内容列>

set -euo pipefail

DB="${1:?用法: bash repair_fts.sh <db_path> <fts_table> <main_table> <content_columns>}"
FTS_TABLE="${2:?请指定 FTS5 虚拟表名}"
MAIN_TABLE="${3:?请指定主表名}"
CONTENT_COLS="${4:?请指定内容列名，如 'role, content'}"

BACKUP="${DB}.bak.$(date +%Y%m%d%H%M%S)"

echo "=== SQLite FTS5 索引修复工具 ==="
echo ""
echo "数据库: $DB"
echo "FTS表:  $FTS_TABLE"
echo "主表:   $MAIN_TABLE"
echo "列:     $CONTENT_COLS"
echo ""

# 1. 备份
echo "[1/5] 备份数据库..."
cp "$DB" "$BACKUP"
echo "  备份已保存到: $BACKUP"
echo ""

# 2. 诊断
echo "[2/5] 诊断当前状态..."
echo "  主表行数:"
sqlite3 "$DB" "SELECT COUNT(*) FROM $MAIN_TABLE;"
echo "  FTS5 完整性检查:"
RESULT=$(sqlite3 "$DB" "SELECT * FROM ${FTS_TABLE}('integrity-check');")
if [ -z "$RESULT" ]; then
    echo "  ✓ FTS5 索引完好"
    read -p "  索引看起来正常，是否仍要继续？(y/N) " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || exit 0
else
    echo "  ✗ 发现问题: $RESULT"
fi
echo ""

# 3. 删除旧 FTS 表及其相关对象
echo "[3/5] 删除旧的 FTS 表..."
sqlite3 "$DB" <<SQL
-- 删除触发器（如果存在）
SELECT 'DROP TRIGGER IF EXISTS ' || name || ';'
FROM sqlite_master WHERE type='trigger' AND tbl_name='$MAIN_TABLE'
AND (name LIKE '%fts%' OR name LIKE '%ai%' OR name LIKE '%ad%' OR name LIKE '%au%');

-- 列出将被删除的相关表
SELECT '  将删除: ' || name FROM sqlite_master
WHERE type='table' AND name LIKE '${FTS_TABLE}%';
SQL

sqlite3 "$DB" <<SQL
DROP TABLE IF EXISTS $FTS_TABLE;
DROP TABLE IF EXISTS ${FTS_TABLE}_data;
DROP TABLE IF EXISTS ${FTS_TABLE}_idx;
DROP TABLE IF EXISTS ${FTS_TABLE}_content;
DROP TABLE IF EXISTS ${FTS_TABLE}_docsize;
DROP TABLE IF EXISTS ${FTS_TABLE}_config;
SQL
echo "  ✓ 已删除"
echo ""

# 4. 重建 FTS 表和索引
echo "[4/5] 重建 FTS 表..."
sqlite3 "$DB" <<SQL
CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5($CONTENT_COLS, content='$MAIN_TABLE', content_rowid='id');
INSERT INTO ${FTS_TABLE}(${FTS_TABLE}) VALUES('rebuild');
SQL
echo "  ✓ 已重建"
echo ""

# 5. 验证
echo "[5/5] 验证..."
RESULT=$(sqlite3 "$DB" "SELECT * FROM ${FTS_TABLE}('integrity-check');")
if [ -z "$RESULT" ]; then
    echo "  ✓ FTS5 索引已修复！"
    COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM $MAIN_TABLE;")
    echo "  ✓ 索引覆盖 $COUNT 条记录"
else
    echo "  ✗ 仍有问题: $RESULT"
    echo "  请从备份恢复: cp $BACKUP $DB"
    exit 1
fi

echo ""
echo "=== 修复完成 ==="
```

### 使用方法

```bash
# 赋予执行权限
chmod +x repair_fts.sh

# 针对 messages 表修复
bash repair_fts.sh ./state.db messages_fts messages "role, content"
```

### 关键步骤解释

| 步骤 | 说明 |
|------|------|
| 备份 | 修复前必须备份，万一出问题可以回退 |
| 诊断 | 用 FTS5 的 `integrity-check` 确认问题 |
| 删除 | 彻底清除损坏的 FTS5 表和 shadow 表 |
| 重建 | 用 `content=` 参数关联主表，`rebuild` 命令重建索引 |
| 验证 | 再次运行 integrity-check 确认修复成功 |

### 修复 `sqlite_sequence`

如果 autoincrement 计数器也异常了：

```sql
-- 查看当前值
SELECT * FROM sqlite_sequence;

-- 重置为实际最大值
UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM messages) WHERE name = 'messages';

-- 或者直接删除，下次插入时会自动重新生成
DELETE FROM sqlite_sequence WHERE name = 'messages';
```

## 最终状态

修复完成后，数据库恢复正常：

```
数据库大小:  111.4 MB
消息总数:    9786
会话数:      186
FTS5 索引:   ✓ 健康
完整性检查:  ok
```

## 经验总结

### 核心教训

> **SQLite + FTS5 跨架构迁移，永远不要用 `.dump` / `.reload`。直接复制 `.db` 文件。**

SQLite 数据库文件是二进制兼容的（前提是字节序相同，x86 和 ARM64 都是小端）。直接 `scp` 或 `rsync` 就行，不需要转成 SQL 文本再导入。

### 如果你必须用 `.dump`

有时候你确实需要文本格式（比如要合并两个数据库、或者要跨字节序迁移），那么：

1. 导出时**排除 FTS5 表**：先 dump 除 FTS 相关表以外的所有内容
2. 导入主表数据
3. 在目标数据库上**重新创建 FTS5 虚拟表**
4. 运行 `INSERT INTO fts_table(fts_table) VALUES('rebuild');` 重建索引
5. 用 `SELECT * FROM fts_table('integrity-check');` 验证

### FTS5 完整性检查速查

```sql
-- 常规检查（不检查 FTS5！）
PRAGMA integrity_check;

-- FTS5 专用检查（这才是正确的）
SELECT * FROM your_fts_table('integrity-check');
-- 返回空 = 正常
-- 返回内容 = 有问题
```

### 迁移前检查清单

- [ ] 备份原始数据库
- [ ] 确认迁移方式（推荐直接复制文件）
- [ ] 迁移后运行 `PRAGMA integrity_check;`
- [ ] 如果有 FTS5，运行 `SELECT * FROM fts_table('integrity-check');`
- [ ] 测试读写操作
- [ ] 检查 `sqlite_sequence` 值是否合理

---

*本文记录于 2026-06-11，基于 Hermes Agent 从 x86_64 Arch Linux 迁移到 ARM64 Armbian 的实际经历。希望对遇到类似问题的朋友有所帮助。*
