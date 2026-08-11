---
title: "ShellCrash sing-box 规则集不生效？模板规则被丢弃的修复记录"
published: 2026-08-11
description: "ShellCrash sing-box 内核规则模板的分流规则完全不生效——规则集下载了但没被引用。完整诊断过程 + 持久化修复方案。"
tags: ["ShellCrash", "sing-box", "路由器", "OpenWrt", "规则分流"]
category: "NAS"
slug: shellcrash-singbox-ruleset-fix
---

# ShellCrash sing-box 规则集不生效？模板规则被丢弃的修复记录

## 问题

在路由器（OpenWrt）上跑 ShellCrash（sing-box 内核），在 TUI 里选了 **"全分组规则+去广告"** 规则模板，规则集文件也都下载好了（`ruleset/*.srs` 一堆），但实际体验是：**国内网站也绕代理，广告不拦截，流媒体不分流**——规则好像完全没起作用。

## 诊断：规则集下载了，但 route 没引用

ShellCrash sing-box 版（1.9.5beta1+，内核 singboxr）的配置生成机制是**多 JSON 模块拼接**：

```
/tmp/ShellCrash/jsons/*.json  （启动时 singbox_modify.sh 生成）
  ├─ route.json        基础路由
  ├─ add_rule_set.json 规则集定义
  ├─ dns.json          DNS 规则
  ├─ outbounds.json    策略组+节点
  └─ cust_*.json       持久化自定义（从 $CRASHDIR/jsons/ 软链）
```

启动命令是 `CrashCore run -D $CRASHDIR -C /tmp/ShellCrash/jsons`（目录模式深度合并）。

排查后发现：

- `add_rule_set.json` 里**只有 `cn` 一个规则集**定义
- `route.json` 只有 6 条基础规则（sniff → dns 劫持 → 内网直连 → 拒 QUIC/BT → **全部走代理**）
- 模板（含完整的分流 rules + 22 个 rule_set 引用）被丢弃，**完全没被合并**

**根因**：`starts/singbox_modify.sh` 的 `gen_dns()` 硬编码只生成 `cn` 规则集；启动时重新生成的 `route.json` 只有基础规则。模板的完整 route（rules + rule_set）**被覆盖/丢弃**——这就是"规则集下载了但分流不生效"的原因。

## 修复：持久化 route.json 补上模板该做的事

不修改 ShellCrash 的脚本（改模板 JSON 会被覆盖，改脚本下次更新又还原），而是利用 ShellCrash **官方设计的持久化机制**：

`$CRASHDIR/jsons/route.json` 会在启动时被软链为 `cust_route.json` 参与合并。所以直接在这个持久化文件里写完整的 route：

```json
{
  "route": {
    "rules": [
      { "action": "sniff" },
      { "protocol": "dns", "action": "hijack-dns" },
      { "ip_is_private": true, "outbound": "DIRECT" },
      { "protocol": "quic", "action": "reject", "no_drop": true },
      { "protocol": "bittorrent", "action": "reject" },
      { "rule_set": ["custom-direct"], "outbound": "DIRECT" },
      { "rule_set": ["custom-proxy"], "outbound": "节点选择" },
      { "rule_set": ["ads"], "outbound": "REJECT" },
      { "rule_set": ["cn", "cnip"], "outbound": "DIRECT" },
      { "outbound": "节点选择" }
    ],
    "rule_set": [
      { "tag": "custom-direct", "type": "local", "format": "binary",
        "path": "/mnt/.../ShellCrash/ruleset/Custom_Direct.srs" }
      // ... 其他规则集定义
    ]
  }
}
```

关键点：

1. **规则集定义用 `local` + 绝对路径**（`path` 指向 `ruleset/*.srs`）。相对路径 `./ruleset/` 在 merge 时工作目录解析有问题，绝对路径最稳。
2. **route 里必须含 `cn` 定义**——`singbox_modify.sh` 检测到持久化目录已有 cn tag 就会**跳过 add_rule_set.json 的生成**，避免重复定义冲突。
3. **规则集文件要先编译好**，用 sing-box 自带的编译命令：

```bash
# 把 Clash .list 转成 sing-box source JSON
# {"version":1,"rules":[{"domain_suffix":"x"},...]}   ← 必须带 version 字段

# 编译成 .srs
/tmp/ShellCrash/CrashCore rule-set compile /tmp/x.json -o /mnt/.../ruleset/X.srs
```

4. 重启用 `./start.sh stop && ./start.sh start`（比 TUI 交互更可靠）。

## 自定义规则（Aethersailor 等 OpenClash 规则）接入

用户想要的 Aethersailor/Custom_OpenClash_Rules 是 **OpenClash（Mihomo）格式**（.mrs/.yaml），sing-box 不能直接用。转换流程：

```
.list（Clash 格式）→ source JSON（{"version":1,"rules":[...]}）→ rule-set compile → .srs
```

把转换好的 `.srs` 放进 `ruleset/`，在 route.json 里加引用即可。自动更新用 crontab：

```bash
# 每周一 4:30 更新自定义规则集
30 4 * * 1 sh /mnt/.../ShellCrash/tools/update_asailor_rules.sh
```

## 验证

```bash
# 看已加载的规则集
curl -s http://127.0.0.1:9999/rules | grep -o 'rule_set=[^"}]*'

# 分流测试
curl -s -x http://127.0.0.1:7890 https://www.google.com/generate_204 -o /dev/null -w '%{http_code}'
# → 204（走代理）
curl -s https://www.baidu.com -o /dev/null -w '%{http_code}'
# → 200（直连）
```

修复后：Google 走代理 204，百度直连 200，广告规则集、流媒体分流全部生效，重启后配置持久保留。

## 总结

- ShellCrash sing-box 模式的**模板 route 被丢弃**是规则"不生效"的根因（已提 issue：[#1326](https://github.com/juewuy/ShellCrash/issues/1326)）
- 修复方式是**利用官方持久化机制**（`$CRASHDIR/jsons/route.json` → `cust_route.json` 合并）补上模板该做的事
- 自定义 OpenClash 规则需要先转成 sing-box .srs 格式才能用
- 规则集定义用 **local + 绝对路径**，route 里含 cn 可避免 add_rule_set 重复生成

## 追加：实战中踩到的两个大坑（2026-08-12）

### 坑 1：全量规则集导致路由器 OOM 崩溃

尝试把 senshinya/singbox_ruleset（blackmatrix7 全集，679 个分类）合并成一个规则集，结果是 **137 万条规则**。路由器（804MB 内存）**直接 OOM 崩溃**，整个路由器失去响应需要手动重启。

**教训**：小内存路由器（<1GB）不要全量合并规则集。正确做法：

- 用 DustinWin 的 30 个 remote .srs（启动按需下载，不占内存）
- 或 senshinya 只选 5-10 个高价值分类（Netflix/YouTube/Steam 等，remote URL 方式）
- 想要全量规则只能上 x86 软路由（内存 ≥2GB）

### 坑 2：官方流程重新生成配置后代理不通

用 TUI 官方流程（6 → b → 1 生成配置）重新生成后，**代理节点完全加载不出来**，所有策略组显示 `Compatible` 空占位。

**根因**：ShellCrash 的 provider 缓存文件 `providers/kq.yaml` 内容是 **sing-box JSON 格式**（`{"outbounds":[...]}`），但 sing-box 1.14 的 provider **默认按 yaml 解析** → 解析失败 → 节点全空。

**最简恢复**：直接用**旧的节点内联版 config.json**（ShellCrash 早期生成的，节点直接内联在 outbounds 里，不依赖 provider 机制）：

```bash
cp $CRASHDIR/jsons/config.json.bak $CRASHDIR/jsons/config.json
# 然后 TUI 启动：mm → 1
```

这个版本的节点是内联的，代理正常（Google 204）。**这是"原来的规则+策略组"最稳定的状态**——不要轻易用 TUI 重新生成配置，否则会触发 provider 格式 bug。

### 附：USB 挂载点变化

路由器重启后 USB 挂载点可能变化（`/mnt/usb-XXXX` 的 XXXX 是 UUID），导致 ShellCrash 找不到。恢复方法：

```bash
# 找到 ShellCrash 实际位置
find /mnt -maxdepth 2 -name "ShellCrash" 2>/dev/null
# 启动（指定 CRASHDIR）
export CRASHDIR=/mnt/usb-XXXX/ShellCrash && sh /mnt/usb-XXXX/ShellCrash/menu.sh
# 菜单里选 1 启动服务
```
