# openclaw-qq

**OpenClaw QQ 渠道扩展 — 基于 [NapCat](https://github.com/NapNeko/NapCatQQ) OneBot v11 协议**

将你的 OpenClaw AI Agent 接入 QQ，支持私聊、群聊、个性化人格定制、LLM 智能回复门控、MongoDB 消息持久化，以及 Web 群管理面板。

[English →](./README.en.md) · [接入指南 →](./docs/setup-guide.md)

---

## 工作原理

```
AI Agent (Claude / Gemini / Qwen / …)
  → OpenClaw Agent Loop
  → openclaw-qq 扩展 (TypeScript)
  → OneBot v11 WebSocket
  → NapCat (QQ Framework)
  → QQ
```

扩展通过 WebSocket 连接 NapCat 的 OneBot v11 服务，接收 QQ 消息，经由 OpenClaw 的 Agent Loop 处理后将回复发回 QQ。所有聊天记录持久化到 MongoDB，超过 token 阈值时自动由 LLM 生成摘要并归档。

---

## 功能特性

### 核心能力

| 功能 | 说明 |
|---|---|
| **私聊** | 与 QQ 好友的双向消息 |
| **群聊** | 响应 @提及，可选被动旁听模式 |
| **多媒体** | 图片收发、@提及、消息引用、表情回应 |
| **定时消息** | 通过 OpenClaw Cron 系统支持主动消息推送 |

### 个性化人格系统

每个 QQ 用户可以拥有专属的 AI 人格设定，支持：

- **角色扮演**：猫娘、宠物、动漫角色等自由定制
- **风格调整**：傲娇、高冷、温柔、毒舌等性格定制
- **称呼定制**：自定义 AI 对用户的称呼方式
- **自动沉淀**：每轮对话后由轻量 LLM 自动分析并更新人格，无需手动操作
- **人格隔离**：每个用户的人格独立，互不影响

未设定专属人格的用户使用默认风格回复。

### 智能消息处理

| 功能 | 说明 |
|---|---|
| **LLM 被动门控** | 轻量 LLM 判断群消息是否需要回复（可配置模型、防抖、可打断） |
| **MongoDB 持久化** | 聊天记录存储在 MongoDB，基于 token 阈值自动压缩 |
| **LLM 摘要压缩** | 超过 token 阈值时，旧消息由 LLM 生成摘要后归档 |
| **管理面板** | Web UI 管理群开关，访问 `/qq/admin` |

---

## 前置条件

| 依赖 | 说明 |
|---|---|
| [OpenClaw](https://github.com/openclaw/openclaw) | 已安装且 gateway 运行中 |
| [NapCat](https://github.com/NapNeko/NapCatQQ) | 已安装且 OneBot v11 WebSocket 服务已开启 |
| MongoDB | 运行中（默认：`mongodb://127.0.0.1:27017`） |
| Node.js | >= 22 |
| QQ 账号 | 已通过 NapCat 登录 |

---

## 快速开始

### 1. 克隆到 OpenClaw 扩展目录

```bash
cd "$(openclaw config get extensionsDir)"
git clone https://github.com/BodaFu/openclaw-qq.git qq
```

### 2. 安装依赖

```bash
cd qq
pnpm install
```

### 3. 配置

编辑 `openclaw.json`（通常在 `~/.openclaw/openclaw.json`）：

```jsonc
{
  "channels": {
    "qq": {
      "accounts": {
        "default": {
          "enabled": true,
          "botQQ": "123456789",
          "botName": "MyBot",
          "ownerQQ": "987654321",
          "ownerName": "我的名字",
          "wsUrl": "ws://127.0.0.1:7900",
          "token": "your_ws_token",

          "dmPolicy": "open",
          "groupPolicy": "open",

          "passiveGate": {
            "enabled": true,
            "model": "qwen3.5-plus",
            "apiUrl": "https://your-api-endpoint/v1/chat/completions",
            "apiKey": "your_api_key",
            "debounceMs": 3000,
            "temperature": 0.3,
            "maxRecentMessages": 15
          },

          "store": {
            "mongoUri": "mongodb://127.0.0.1:27017",
            "dbName": "your_db_name",
            "tokenThreshold": 8000,
            "compactKeepRecent": 10,
            "compactModel": "qwen3.5-plus",
            "compactApiUrl": "https://your-api-endpoint/v1/chat/completions",
            "compactApiKey": "your_compact_api_key"
          }
        }
      }
    }
  }
}
```

### 4. 重启 Gateway

```bash
openclaw gateway restart
```

---

## 配置参考

### 账号级配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 启用/禁用此账号 |
| `botQQ` | `string` | — | Bot 的 QQ 号（必填） |
| `botName` | `string` | `"Bot"` | Bot 显示名称 |
| `ownerQQ` | `string` | `""` | 主人的 QQ 号（配置后启用身份识别和上报通知机制） |
| `ownerName` | `string` | `""` | 主人的称呼（用于 Agent 提示词中） |
| `wsUrl` | `string` | `"ws://127.0.0.1:7900"` | NapCat OneBot WebSocket 地址 |
| `token` | `string` | `""` | OneBot 访问令牌 |
| `dmPolicy` | `string` | `"open"` | 私聊策略：`open`、`pairing`、`disabled` |
| `groupPolicy` | `string` | `"open"` | 群聊策略：`open`、`allowlist`、`disabled` |
| `groupAllowFrom` | `string[]` | `[]` | 允许的群号列表（`allowlist` 模式） |
| `allowFrom` | `string[]` | `[]` | 允许私聊的 QQ 号列表 |
| `requireMention` | `boolean` | `false` | 群聊中是否需要 @提及才回复 |
| `historyLimit` | `number` | `25` | Agent 上下文中的最近消息数 |
| `textChunkLimit` | `number` | `4000` | 单条文本最大字符数 |

### 被动门控配置（`passiveGate`）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 启用 LLM 被动门控 |
| `model` | `string` | `"qwen3.5-plus"` | 门控 LLM 模型 |
| `apiUrl` | `string` | — | OpenAI 兼容 API 地址 |
| `apiKey` | `string` | `""` | API 密钥 |
| `debounceMs` | `number` | `3000` | 防抖窗口（毫秒） |
| `temperature` | `number` | `0.3` | LLM 温度 |
| `maxRecentMessages` | `number` | `15` | 发送给门控 LLM 的最近消息数 |

> 被动门控的 LLM 配置同时被人格沉淀模块复用。

### 存储配置（`store`）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mongoUri` | `string` | `"mongodb://127.0.0.1:27017"` | MongoDB 连接 URI |
| `dbName` | `string` | `"openclaw_qq"` | 数据库名 |
| `tokenThreshold` | `number` | `8000` | 触发压缩的 token 阈值 |
| `compactKeepRecent` | `number` | `10` | 压缩后保留的最近消息数 |
| `compactModel` | `string` | `"qwen3.5-plus"` | 摘要 LLM 模型 |
| `compactApiUrl` | `string` | — | 摘要 LLM API 地址 |
| `compactApiKey` | `string` | `""` | API 密钥（未设置时回退到 `passiveGate.apiKey`） |

---

## 个性化人格系统

### 架构

```
用户消息 → 加载用户人格 → 注入 Agent 上下文 → Agent 回复 → 回复完成
                                                                ↓
                                                     异步人格沉淀（不阻塞）
                                                                ↓
                                                     轻量 LLM 分析本轮对话
                                                                ↓
                                                     有变更 → 更新 MongoDB
                                                     无变更 → 跳过
```

### 工作方式

1. **人格注入**：每次收到消息时，系统从 MongoDB 加载发言人的专属人格，注入到 Agent 的上下文中
2. **自动沉淀**：Agent 回复完成后，异步调用轻量 LLM 分析本轮对话，检测是否包含人格变更信号
3. **人格隔离**：群聊中每个用户的人格独立，A 用户的定制不影响 B 用户

### 检测的变更信号

- 明确要求：「你以后傲娇一点」「做我的猫娘」「叫我哥哥」
- 隐式偏好：纠正称呼、嫌 AI 太正经/太随意/回复太长
- 角色设定：发送完整的角色描述或设定关系
- 起哄/玩梗等非正式请求不会被沉淀

### 数据存储

人格数据存储在 MongoDB 的 `qq_user_personas` 集合中，包含：

- `persona`：人格描述（最长 500 字）
- `nickname`：用户希望被叫的称呼
- `likoNickname`：用户给 AI 起的昵称
- `traits`：特征标签数组
- `evolutionLog`：人格演化历史

---

## 管理面板

访问群管理 Web UI：

```
http://localhost:<gateway端口>/qq/admin
```

功能：
- 查看 Bot 已加入的所有群
- 单独开关每个群
- 设置新群的默认策略

---

## NapCat 部署指南（macOS）

### 安装 NapCat

1. 从 [NapCatQQ Releases](https://github.com/NapNeko/NapCatQQ/releases) 下载，或使用 [NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer)
2. QQ 版本要求：**6.9.86** 或兼容版本
3. 使用 Mac Installer DMG 安装

### macOS 沙盒问题

```bash
/Applications/QQ.app/Contents/MacOS/QQ --no-sandbox -q 你的QQ号
```

> macOS 上必须使用 `--no-sandbox`，否则 NapCat 会报 `EPERM` 权限错误。

### 配置 OneBot WebSocket 服务

1. 打开 NapCat WebUI（默认：`http://127.0.0.1:6099/webui`）
2. 进入 **网络配置** → 添加 **WebSocket 服务器**
3. 设置主机 `0.0.0.0`、端口 `7900`、访问令牌、消息格式 `array`
4. 保存并重启 NapCat

### 常见问题

| 问题 | 解决方案 |
|---|---|
| Worker 进程反复退出 | 确认 QQ 版本与 NapCat 兼容；清除缓存后重新登录 |
| `EPERM` 权限错误 | 启动 QQ 时使用 `--no-sandbox` |
| 扫码登录卡住 | 删除 `~/.config/NapCat/` 后重试 |
| WebSocket 连接失败 | 确认端口和 token 与配置一致 |

---

## 项目结构

```
openclaw-qq/
├── index.ts                       # 插件入口
├── package.json
├── openclaw.plugin.json
└── src/
    ├── channel.ts                 # 渠道定义 & Agent 提示词
    ├── config.ts                  # 配置解析
    ├── types.ts                   # 类型定义
    ├── outbound.ts                # 出站消息适配器
    ├── actions.ts                 # 消息工具动作（send / react / persona_update）
    ├── runtime.ts                 # 运行时引用
    ├── onebot/
    │   ├── client.ts              # OneBot v11 WebSocket 客户端
    │   └── types.ts               # OneBot 协议类型
    ├── monitor/
    │   ├── index.ts               # 监控启动（WS + MongoDB 初始化）
    │   ├── message-handler.ts     # 消息路由（私聊 / 群聊 / 人格注入）
    │   ├── passive-gate.ts        # LLM 被动回复门控
    │   ├── file-handler.ts        # 群文件处理
    │   └── client-ref.ts          # 共享客户端引用
    ├── persona/
    │   ├── persona-distiller.ts   # 对话后 LLM 人格分析与自动沉淀
    │   └── handle-persona-action.ts # persona_update 工具动作
    ├── store/
    │   ├── connection.ts          # MongoDB 连接管理
    │   ├── chat-store.ts          # 消息持久化 & LLM 摘要压缩
    │   ├── persona-store.ts       # 用户人格持久化
    │   └── types.ts               # 存储数据类型
    ├── admin/
    │   ├── routes.ts              # 管理 API 路由
    │   ├── admin-store.ts         # 管理配置存储
    │   ├── page.ts                # 管理 Web UI
    │   └── group-cache.ts         # 群列表缓存
    └── utils/
        ├── message-parser.ts      # 消息段解析
        ├── mention.ts             # @提及检测
        ├── member-cache.ts        # 群成员信息缓存
        ├── media.ts               # 媒体处理
        └── text-format.ts         # 文本格式化
```

---

## 许可证

[MIT](./LICENSE)
