# QQ Bot 接入指南

从零开始，在已部署好的 OpenClaw 上接入 QQ Bot。

---

## 总览

你需要完成以下步骤：

```
1. 准备 QQ 小号 → 2. 部署 NapCat → 3. 安装本扩展 → 4. 配置 → 5. 启动验证
```

整个过程约 15-30 分钟。

---

## 第一步：准备环境

### 前置条件

| 依赖 | 要求 |
|---|---|
| OpenClaw | 已安装，gateway 可正常启动 |
| Node.js | >= 22 |
| MongoDB | 运行中（默认 `mongodb://127.0.0.1:27017`） |
| QQ 账号 | 准备一个用作 Bot 的 QQ 号（建议用小号） |
| LLM API | 任意 OpenAI 兼容接口（被动门控 + 人格沉淀需要） |

### 确认 OpenClaw 正常运行

```bash
# 检查 gateway 是否在运行
openclaw gateway status

# 如果没有运行，启动它
openclaw gateway install
```

### 确认 MongoDB 正常运行

```bash
# macOS (Homebrew)
brew services list | grep mongodb

# 或直接测试连接
mongosh --eval "db.runCommand({ping: 1})"
```

---

## 第二步：部署 NapCat

NapCat 是 QQ 的第三方框架，提供 OneBot v11 协议接口，是本扩展与 QQ 通信的桥梁。

### macOS

1. 下载 [NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer) 的 DMG
2. 安装后，使用以下命令启动 QQ（**必须加 `--no-sandbox`**）：

```bash
/Applications/QQ.app/Contents/MacOS/QQ --no-sandbox -q <你的Bot QQ号>
```

> macOS 沙盒限制会导致 NapCat 报 `EPERM` 错误，`--no-sandbox` 是必须的。

3. 扫码或密码登录 Bot QQ 号

### Linux（Docker，推荐）

```bash
docker run -d \
  --name napcat \
  -e NAPCAT_GID=0 \
  -e NAPCAT_UID=0 \
  -e ACCOUNT=<你的Bot QQ号> \
  -p 6099:6099 \
  -p 7900:7900 \
  mlikiowa/napcat-docker:latest
```

登录方式参考 [NapCat 官方文档](https://github.com/NapNeko/NapCatQQ)。

### 配置 OneBot WebSocket 服务

1. 打开 NapCat WebUI：`http://127.0.0.1:6099/webui`
2. 进入 **网络配置** → 添加 **正向 WebSocket 服务器**
3. 填写：

| 配置项 | 值 |
|---|---|
| 主机 | `0.0.0.0` |
| 端口 | `7900` |
| 访问令牌 | 自定义一个 token（后面要用） |
| 消息格式 | `array` |

4. 保存并重启 NapCat

### 验证 NapCat

确认 WebSocket 服务可连接：

```bash
# 简单测试端口是否开放
nc -z 127.0.0.1 7900 && echo "OK" || echo "FAIL"
```

---

## 第三步：安装扩展

```bash
# 进入 OpenClaw 扩展目录
cd "$(openclaw config get extensionsDir)"

# 克隆本仓库
git clone https://github.com/BodaFu/openclaw-qq.git qq

# 安装依赖
cd qq
pnpm install
```

---

## 第四步：配置

编辑 OpenClaw 配置文件（通常在 `~/.openclaw/openclaw.json`）。

### 最小配置

只需要 3 个必填项就能跑起来：

```jsonc
{
  "channels": {
    "qq": {
      "accounts": {
        "default": {
          "botQQ": "<Bot的QQ号>",
          "wsUrl": "ws://127.0.0.1:7900",
          "token": "<NapCat中设置的访问令牌>"
        }
      }
    }
  }
}
```

### 推荐配置

加上 Bot 名称、主人识别、被动门控和存储：

```jsonc
{
  "channels": {
    "qq": {
      "accounts": {
        "default": {
          // 基本信息
          "enabled": true,
          "botQQ": "<Bot的QQ号>",
          "botName": "<Bot的名字>",
          "wsUrl": "ws://127.0.0.1:7900",
          "token": "<NapCat访问令牌>",

          // 主人识别（可选，配置后 Bot 会识别你的身份并向你上报事件）
          "ownerQQ": "<你的QQ号>",
          "ownerName": "<你的称呼>",

          // 消息策略
          "dmPolicy": "open",          // 私聊：open / pairing / disabled
          "groupPolicy": "open",       // 群聊：open / allowlist / disabled
          "requireMention": false,     // 群里是否需要 @Bot 才回复

          // 被动门控（群聊智能过滤，同时用于人格沉淀）
          "passiveGate": {
            "enabled": true,
            "model": "qwen3.5-plus",
            "apiUrl": "https://your-llm-api/v1/chat/completions",
            "apiKey": "<你的API Key>",
            "debounceMs": 3000,
            "temperature": 0.3,
            "maxRecentMessages": 15
          },

          // 存储
          "store": {
            "mongoUri": "mongodb://127.0.0.1:27017",
            "dbName": "my_qq_bot"
          }
        }
      }
    }
  }
}
```

### 配置项说明

详细的配置参考见 [README.md](../README.md#配置参考)。这里说几个关键决策：

**`dmPolicy` 私聊策略：**
- `open`：所有人都可以私聊 Bot
- `pairing`：只有 Bot 先主动发过消息的人才能私聊
- `disabled`：关闭私聊

**`groupPolicy` 群聊策略：**
- `open`：所有群都响应
- `allowlist`：只响应 `groupAllowFrom` 列表中的群
- `disabled`：关闭群聊

**`passiveGate` 被动门控：**
- 群聊中 Bot 不是每条消息都回复，而是由一个轻量 LLM 判断"这条消息是否需要我回复"
- 这个 LLM 配置同时被人格沉淀模块复用，所以即使你不需要群聊过滤，也建议配置（否则人格自动沉淀不会工作）

---

## 第五步：启动验证

### 1. 重启 Gateway

```bash
openclaw gateway restart
```

如果 `restart` 卡住，可以手动操作：

```bash
openclaw gateway stop
sleep 2
openclaw gateway install
```

### 2. 检查日志

```bash
# 查看实时日志
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep qq
```

你应该看到类似输出：

```
[qq] 启动 Monitor: bot=123456789 ws=ws://127.0.0.1:7900
[qq] MongoDB 已连接: my_qq_bot
[qq] [QQ/OneBot] WebSocket connected
[qq] 已登录: MyBot (123456789)
[qq] 群列表: 群名1(群号1), 群名2(群号2)
```

### 3. 发送测试消息

用你的 QQ 号给 Bot 发一条私聊消息，比如"你好"。如果 Bot 回复了，说明接入成功。

### 4. 检查管理面板

打开浏览器访问：

```
http://localhost:<gateway端口>/qq/admin
```

你应该能看到 Bot 加入的所有群，以及开关控制。

---

## 常见问题

### 连接问题

| 问题 | 排查 |
|---|---|
| `WebSocket connection failed` | 确认 NapCat 的 WS 服务已启动，端口和 token 与配置一致 |
| `MongoDB 连接失败` | 确认 MongoDB 正在运行：`mongosh --eval "db.runCommand({ping:1})"` |
| Gateway 启动后 Bot 不回复 | 查看日志是否有 `API rate limit` 或 Agent 超时错误 |

### NapCat 问题

| 问题 | 解决 |
|---|---|
| macOS `EPERM` 错误 | 启动 QQ 时加 `--no-sandbox` |
| Worker 进程反复退出 | 确认 QQ 版本与 NapCat 兼容，清除 `~/.config/NapCat/` 后重试 |
| 扫码登录卡住 | 删除 `~/.config/NapCat/` 重试 |
| QQ 版本不兼容 | NapCat 通常要求特定 QQ 版本，参考 NapCat Release Notes |

### 群聊问题

| 问题 | 排查 |
|---|---|
| Bot 不回复群消息 | 检查 `groupPolicy` 是否为 `open`；检查管理面板中该群是否已启用 |
| Bot 回复太频繁 | 启用 `passiveGate` 并调高 `debounceMs` |
| Bot 回复太慢 | 检查 Agent LLM 的响应速度；`passiveGate.debounceMs` 会引入额外延迟 |
| 群里需要 @Bot 才回复 | 设置 `requireMention: true`，或在管理面板中按群配置 |

### 人格系统问题

| 问题 | 排查 |
|---|---|
| 人格没有自动保存 | 确认 `passiveGate` 已配置 `apiKey` 和 `apiUrl`（人格沉淀复用此配置） |
| A 用户的人格影响了 B 用户 | 正常情况下不会发生；如果出现，重启 Gateway 清除 Agent 上下文 |
| 想重置某用户的人格 | 在 MongoDB 中删除对应记录：`db.qq_user_personas.deleteOne({userId: "QQ号"})` |

---

## 进阶配置

### 按群单独配置

```jsonc
{
  "groups": {
    "123456789": {
      "enabled": true,
      "requireMention": true,      // 这个群需要 @Bot
      "historyLimit": 50           // 这个群保留更多上下文
    },
    "987654321": {
      "enabled": false             // 关闭这个群
    },
    "*": {
      "enabled": true              // 其他群默认开启
    }
  }
}
```

### 白名单模式

只允许特定群和特定用户：

```jsonc
{
  "groupPolicy": "allowlist",
  "groupAllowFrom": ["群号1", "群号2"],
  "allowFrom": ["QQ号1", "QQ号2"]
}
```

### 多账号

支持同时运行多个 QQ Bot（需要多个 NapCat 实例）：

```jsonc
{
  "channels": {
    "qq": {
      "accounts": {
        "bot1": {
          "botQQ": "111111111",
          "wsUrl": "ws://127.0.0.1:7900",
          "token": "token1"
        },
        "bot2": {
          "botQQ": "222222222",
          "wsUrl": "ws://127.0.0.1:7901",
          "token": "token2"
        }
      }
    }
  }
}
```

---

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                        QQ 用户                           │
└──────────────────────────┬──────────────────────────────┘
                           │ QQ 协议
┌──────────────────────────▼──────────────────────────────┐
│              NapCat (OneBot v11 Framework)               │
│                  WebSocket Server :7900                  │
└──────────────────────────┬──────────────────────────────┘
                           │ OneBot v11 WS
┌──────────────────────────▼──────────────────────────────┐
│                    openclaw-qq 扩展                       │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ OneBot 客户端 │  │  消息处理器   │  │   被动门控     │  │
│  │  (WS 连接)   │→ │ (路由/上下文) │→ │  (LLM 过滤)   │  │
│  └─────────────┘  └──────┬───────┘  └────────────────┘  │
│                          │                               │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │              人格系统                               │  │
│  │  加载人格 → 注入上下文 → 回复后异步沉淀             │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                               │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │              MongoDB 存储                           │  │
│  │  聊天记录 │ 用户人格 │ 管理配置                      │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │ Agent API
┌──────────────────────────▼──────────────────────────────┐
│                   OpenClaw Agent Loop                    │
│              (Claude / Gemini / Qwen / …)               │
└─────────────────────────────────────────────────────────┘
```
