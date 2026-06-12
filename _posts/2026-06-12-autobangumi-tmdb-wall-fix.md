---
layout: post
title: "AutoBangumi TMDB 被墙？不用代理，一行 sed 搞定"
date: 2026-06-12
tags: [AutoBangumi, TMDB, Docker, NAS, fnOS]
lang: zh-CN
---

# AutoBangumi TMDB 被墙？不用代理，一行 sed 搞定

## 问题

AutoBangumi（AB）用 TMDB 获取番剧元数据。默认请求的是 `api.themoviedb.org`，但这个域名在国内很多网络环境下丢包严重甚至完全不通，导致元数据查询持续超时。

AB 虽然支持 HTTP 代理（`proxy.enable`），但不是所有人都能搭代理。有没有更简单的办法？

## 答案

`api.themoviedb.org` 的短域名 `api.tmdb.org` 在很多国内网络下是通的。只需把容器里的硬编码 URL 换掉就行。

## 方法

### 第一步：找到要改的文件

AB 容器里硬编码 TMDB URL 的文件：

| 文件 | 硬编码 URL |
|------|-----------|
| `/app/module/parser/analyser/tmdb_parser.py` | `https://api.themoviedb.org` |
| `/app/module/parser/analyser/tmdb_parser.py` | `https://image.tmdb.org/t/p/w780` |
| `/app/module/bgmi_calendar.py` | `https://api.bgm.tv/calendar` |

一般只需要改第一个。`image.tmdb.org` 和 `api.bgm.tv` 通常能通。

### 第二步：进容器改

```bash
docker exec -it AutoBangumi bash

# 替换 TMDB API 域名
sed -i 's|https://api.themoviedb.org|https://api.tmdb.org|g' /app/module/parser/analyser/tmdb_parser.py

# 退出容器后重启
exit
docker restart AutoBangumi
```

改完立刻生效，AB 会用 `api.tmdb.org` 请求 TMDB。

### 第三步：持久化（关键）

容器重建（更新镜像、`docker-compose down && up`）后改动会丢失。两种方式持久化：

#### 方式一：crontab 脚本（推荐）

写一个脚本，NAS 启动时自动 patch：

```bash
#!/bin/bash
# /vol1/1000/Mikan/autobangumi/patch_tmdb.sh

sleep 10  # 等容器启动

FILE=/app/module/parser/analyser/tmdb_parser.py
CONTAINER=AutoBangumi

if docker exec $CONTAINER grep -q 'api.themoviedb.org' "$FILE" 2>/dev/null; then
    docker exec $CONTAINER sed -i 's|https://api.themoviedb.org|https://api.tmdb.org|g' "$FILE"
    docker restart $CONTAINER
    echo "$(date): TMDB patched" >> /vol1/1000/Mikan/autobangumi/patch.log
fi
```

加到 crontab：

```bash
crontab -e
# 加入：
@reboot /vol1/1000/Mikan/autobangumi/patch_tmdb.sh
```

脚本有判断逻辑：只有 URL 还没被改过才执行 patch，避免重复重启。

#### 方式二：Dockerfile 继承（更规范）

```dockerfile
FROM ghcr.io/estrellaxd/auto_bangumi:latest
RUN sed -i 's|https://api.themoviedb.org|https://api.tmdb.org|g' \
    /app/module/parser/analyser/tmdb_parser.py
```

然后用这个自定义镜像代替官方镜像。缺点是每次 AB 更新要重新 build。

## 验证

改完后查看 AB 日志，TMDB 请求应该不再超时：

```bash
docker logs AutoBangumi --tail 50 | grep -i tmdb
```

如果看到正常的元数据返回而不是 timeout，就成功了。

## 总结

| 方案 | 优点 | 缺点 |
|------|------|------|
| `sed` + crontab | 简单，一行命令 | 容器重建要等脚本触发 |
| Dockerfile 继承 | 更新时自动生效 | 每次 AB 更新要重新 build |
| HTTP 代理 | AB 原生支持 | 需要搭代理服务器 |

对于不想折腾代理的用户，`sed` 替换是最快的方案。

---

> 我已向 AB 开发者提交了 [Feature Request #1042](https://github.com/EstrellaXD/Auto_Bangumi/issues/1042)，建议在配置中增加自定义 API Base URL 的选项。如果被采纳，以后就不需要手动 patch 了。
