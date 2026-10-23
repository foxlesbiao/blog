---
title: "小黑盒 MCP：从抓包到 Native 签名的完整逆向"
published: 2026-10-23
description: "用 Unidbg 复现小黑盒 Android App 的 hkey/_rnd 签名，从抓包分析到 Unidbg JNI 环境搭建的完整过程。"
tags: [逆向, Android, Unidbg, MCP, 小黑盒]
category: hermes
draft: false
---

# 小黑盒 MCP：从抓包到 Native 签名的完整逆向

## 背景

[codex-mcp](https://github.com/foxlesbiao/xiaoheihe-mcp) 是我给小黑盒社区做的只读 MCP Server，支持搜索、话题、游戏、帖子浏览和登录态管理。仓库本身不含签名算法源码——签名器以外部命令方式提供，用户需要自行实现。这篇文章完整记录签名算法的逆向过程和实现细节，给同样想走这条路的人参考。

## API 请求签名概览

小黑盒 API 请求需要两类签名参数：

| 签名类型 | 关键参数 | 使用场景 |
|---|---|---|
| Web 签名 | `hkey`、`_rnd`、`_time`、`nonce` | 公开 Web API 浏览 |
| Native 签名 | `hkey`、`_rnd`（由 SO 计算） | 登录、已登录功能 |

两者输出格式相似但计算路径完全不同。Web 签名是纯算法，Native 签名由 Android SO 中的 JNI 方法计算。

## 抓包分析

用 Charles 做 HTTPS 中间人抓包，每个请求都带：

```
_time=1700000000
nonce=aBcD...32位随机字符
hkey=XXXX0000
_rnd=15:hex_string
version=999.0.4
```

用 Frida hook `okhttp3.Request`，定位到签名在 `com.graphice.shaderar.ShaderManager`（JNI 对应 `libglesv3_1.so`）和 `com.max.xiaoheihe.utils.NDKTools`（JNI 对应 `libnative-lib.so`）中生成。

## Web 签名算法

Web 签名用于非登录状态的公开 API，纯算法可复现，不依赖 SO。

### hkey 计算

```python
R_CHARSET = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89"

# 1. timestamp+1 经字符表映射（取前 2 个字符的 ord % 2）
part_time = tw(str(timestamp + 1), R_CHARSET, 2)

# 2. 路径规范化：/api/endpoint/ → 每字符 ord % len(R_CHARSET) 映射
part_path = rw(normalized_path, R_CHARSET)

# 3. nonce 同样映射
part_nonce = rw(nonce, R_CHARSET)

# 4. 三段交错拼接取前 20 字符 → MD5
combined = interleave([part_time, part_path, part_nonce])[:20]
digest = md5(combined.encode()).hexdigest()

# 5. digest 后 6 字符做自定义列混淆（位运算 + XOR）
transformed = mix_columns([ord(c) for c in digest[-6:]])

# 6. hkey = 映射(digest[:5]) + pad(sum(transformed) % 100, 2)
```

其中 `mix_columns` 用到一组位运算变换链：

```python
def ty(v): return ((v << 1) ^ 27) & 255 if v & 128 else v << 1
def da(v): return ty(v) ^ v
def vs(v): return da(ty(v))
def dol_c(v): return vs(da(ty(v)))
def dl(v): return dol_c(v) ^ vs(v) ^ da(v)

# 4x4 列混淆
result[i] = dl(a) ^ dol_c(b) ^ vs(c) ^ da(d)  # 按不同顺序组合
```

### _rnd 计算

```python
RND_KEY = "Z7mFG4tQp9Ws2LxB8H"

message = (RND_KEY + nonce + f"{timestamp}:{nonce}").encode()
_rnd = "15:" + hmac.new(
    RND_KEY.encode(), message, hashlib.sha256
).hexdigest()
```

## Native App 签名（Unidbg）

Native 签名由 SO 库计算，无法用纯 Python 复现。方案是 [Unidbg](https://github.com/zhkl0228/unidbg) 模拟执行。

### 签名调用链

```
1. 初始化 SO：
   ShaderManager.setParseDepth("/tmp/xhh-cache", false)
   ShaderManager.setSecLevel()
   ShaderManager.setBlendMode(BLEND_SEED, timestamp)

2. 获取 chunk flag：
   ShaderManager.getChunkFlag(context, CHUNK_SEED) → chunk_flag

3. 生成 nonce：
   ShaderManager.getIdxOffset(context, chunk_flag, timestamp, identity) → nonce

4. 设置签名上下文：
   ShaderManager.setViewport(timestamp, nonce)
   ShaderManager.setGramLen(path, nonce)
   ShaderManager.setBuf(timestamp, nonce)
   ShaderManager.setDepRel(device_model, nonce)
   ShaderManager.setDLen(os_version, nonce)
   ShaderManager.setPtrOffset(app_version, nonce)

5. 编码：
   NDKTools.encode(context, path, timestamp, nonce)

6. 获取签名：
   ShaderManager.getObjType(context, nonce, false) → hkey
   ShaderManager.getObjType(context, nonce, true)  → rnd_suffix

7. 输出：
   _rnd = security_version_or_os_version + ":" + rnd_suffix
```

### 种子常量

从 SO 中提取的两个关键种子：

```
CHUNK_SEED = "PAENEHAMGACOBHIEMIHIJLKJPMMHJMMQABCNGBPPENCENP"
BLEND_SEED = "MFANEHAMGACOBHIEMIHIJLKJPMMHJMMLABCNGBPPENCENPOM"
```

### JNI 环境模拟

Unidbg 需要模拟 Android 环境中 SO 期望的所有 JNI 调用：

```java
getPackageName()     → "com.max.xiaoheihe"
getFilesDir()        → "/data/user/0/com.max.xiaoheihe/files"
getCacheDir()        → "/data/user/0/com.max.xiaoheihe/cache"
Build.MODEL          → 设备型号
Build.BRAND          → "vivo"
Build.VERSION.RELEASE → Android 版本
PackageInfo.signatures → 从 APK 解析证书
getSharedPreferences(...) → 空实现
getString("DebugInfo") → imei + identity
```

### 安全上下文注入

从真机抓包的 `/account/getui/fix` 响应中获取 `security_code` 和 `security_version`，在签名前注入：

```java
ShaderManager.setHdrField(Base64.decode(security_code))
ShaderManager.b = true              // 静态 boolean
ShaderManager.c = security_version  // 静态 int
```

这会影响 `_rnd` 前缀：用 `security_version` 替代 `os_version`。

### Unidbg 环境搭建

```java
AndroidEmulator emulator = AndroidEmulatorBuilder.for64Bit()
    .setProcessName("com.max.xiaoheihe")
    .addBackendFactory(new Unicorn2Factory(true))
    .build();

emulator.getSyscallHandler().addIOResolver(this);
Memory memory = emulator.getMemory();
memory.setLibraryResolver(new AndroidResolver(23));

VM vm = emulator.createDalvikVM(new File(resources, "minimal-app.apk"));
vm.setVerbose(false);
vm.setJni(this);

DalvikModule shaderModule = vm.loadLibrary(
    new File(resources, "libglesv3_1.so"), true);
shaderModule.callJNI_OnLoad(emulator);

DalvikModule nativeModule = vm.loadLibrary(
    new File(resources, "libnative-lib.so"), true);
nativeModule.callJNI_OnLoad(emulator);

DvmClass shaderManager = vm.resolveClass("com/graphice/shaderar/ShaderManager");
DvmClass ndkTools = vm.resolveClass("com/max/xiaoheihe/utils/NDKTools");
```

## SMS 登录加密

App 使用 RSA PKCS#1 v1.5 加密手机号（1024 位，公钥从 APK 提取）。公钥本身不是秘密，加密流程就是标准 RSA：

```python
# 从 DER 提取 modulus 和 exponent
modulus = ... # 1024 bit
exponent = 65537

# PKCS#1 v1.5 填充
block = b"\x00\x02" + random_nonzero_padding + b"\x00" + phone_bytes
cipher = pow(int.from_bytes(block, "big"), exponent, modulus)
result = base64.b64encode(cipher.to_bytes(128, "big"))
# 按 76 字符换行
```

登录请求还需要一组设备指纹查询参数（`imei`、`device_info`、`os_version` 等），与签名一起发送。

## 外部签名器接口

仓库通过 `XIAOHEIHE_SIGNER_COMMAND` 环境变量或 `config.json` 的 `signer_command` 字段指定外部签名器路径。签名器接受命令行参数并输出 JSON：

```
signer <path> <timestamp> <identity> <device> <os-version> <app-version> <imei> <security-code> <security-version>
```

输出：

```json
{
  "path": "/api/endpoint/",
  "_time": "1700000000",
  "nonce": "随机32字符",
  "hkey": "8位签名",
  "_rnd": "前缀:签名值"
}
```

## 合规

本文仅供个人学习、研究和兼容性分析。逆向工程可能违反平台服务条款和当地法律。请勿用于商业化、批量采集或恶意用途。
