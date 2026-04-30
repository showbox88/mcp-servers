# mcp-servers

Claude Code 的 MCP server 集合。每个子目录 = 一个 app 的工具暴露层。

## 目录

| 目录 | 用途 | 状态 |
|---|---|---|
| `smart-trip/` | Smart Trip 行程数据读写（直连 Supabase） | 一期 |
| `_template/` | 新 MCP 复制模板 | 模板 |

> 后续 app（Voice / 音乐 / 价格追踪 / …）按 `_template` 套路加兄弟目录。

## 快速开始（以 smart-trip 为例）

```bash
cd smart-trip
cp .env.example .env       # 填入 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DEFAULT_USER_ID
npm install
npm run build
```

然后用 `claude mcp add` 注册（**用户级**，所有工作目录都能用）：

```bash
claude mcp add -s user smart-trip -- node "E:/Project/mcp-servers/smart-trip/dist/index.js"
```

> `-s user` 是用户级；不带就是当前项目级。`--` 后面是子进程命令。

确认：`claude mcp list` 应能看到 `smart-trip`。重启 Claude Code，新对话里 `/mcp` 应显示 `smart-trip ✓ 已连接`，工具列表里有 12 个 trip/day/stop/place 工具。

## 加新 app 的 MCP

```bash
cp -r _template my-app
cd my-app
# 改 package.json 里的 name / bin
# 改 src/index.ts 里的 server name
# 写工具（参考 smart-trip/src/tools/）
npm install && npm run build
```

然后用 `claude mcp add -s user my-app -- node "E:/Project/mcp-servers/my-app/dist/index.js"` 注册，**重启 Claude Code**。

## 设计约定

- **协议**：MCP over stdio（Claude Code 把每个 server 当子进程拉起）
- **语言**：Node.js + TypeScript（统一一套生态，方便互相借鉴）
- **SDK**：`@modelcontextprotocol/sdk@^1.29.0`（v1 稳定，不用 v2 alpha）
- **校验**：`zod` 入参校验（v1 SDK 用 raw zod shape，不包 `z.object`）
- **机密**：每个 MCP 自己读 `.env`，不要把 secret 写进 `settings.json`
- **错误**：返回 `{ content: [...], isError: true }` 让 Claude 看到错误能自我纠正
- **日志**：必须 `console.error` 走 stderr，stdout 是 MCP 协议帧通道
