# mcp-servers

Claude Code 的 MCP server 集合。每个子目录 = 一个 app 的工具暴露层。

仓库：https://github.com/showbox88/mcp-servers

## 目录

| 目录 | 用途 | 状态 |
|---|---|---|
| `smart-trip/` | Smart Trip 行程数据读写（直连 Supabase） | 一期，15 个工具，stdio + HTTP 双入口 |
| `_template/` | 新 MCP 复制模板 | 模板 |

> Phase 1 部署架构（办公室 Proxmox Linux VM + Tailscale Funnel）：见 `smart-trip/README.md` 的"远程部署"章节。

> 后续 app（Voice / 音乐 / 价格追踪 / …）按 `_template` 套路加兄弟目录。

## 多机使用说明

这个仓库走 git 同步，**多机共用同一份 Supabase 真相**。在任一台机器上写入的行程，另一台机器的 Claude Code 立刻能看到。

已知的部署位置（按机器记录路径，方便对照）：

| 机器 | 路径 | 用途 |
|---|---|---|
| 家用 PC | `E:\Project\mcp-servers\` | 主开发机，第一个 MCP 落地的地方 |
| 办公室 PC | `D:\Projects\mcp-server\` | 第二台，2026-04-30 接入 |

> ⚠️ 路径不同，所以下文 `claude mcp add` 命令里的绝对路径要按当前机器替换。

**新机器接入清单**（30 分钟）：

1. 装好 Node 20+、Claude Code CLI、git
2. `git clone https://github.com/showbox88/mcp-servers.git <你想放的路径>`
3. `cd <路径>/smart-trip && cp .env.example .env`
4. 编辑 `.env`，填入 `SUPABASE_SERVICE_ROLE_KEY` 和 `DEFAULT_USER_ID`（取值方法见 `smart-trip/.env.example` 注释或 `smart-trip/README.md`）
5. `npm install && npm run build`
6. `claude mcp add -s user smart-trip -- node "<绝对路径>/smart-trip/dist/index.js"`
7. 重启 Claude Code，新对话里 `/mcp` 应显示 `smart-trip ✓`

> `.env` 是 gitignore 的，不会跨机同步，每台机器独立填写。这是设计，不是 bug——service_role key 不进 git。

**多机协作避坑**：

- `stops_data` 是 JSONB 数组，read-modify-write，**两台机器同时改同一个 day 的 stops 会丢更新**。规划时一台机器改完再另一台开。日常使用单机即可。
- 装好新工具后要 `git push` / 另一台 `git pull && cd smart-trip && npm run build`，否则两台机器的 MCP 工具集会不一致。
- `dist/` 不进 git（`.gitignore` 排除），所以 `git pull` 之后必须重新 `npm run build`。

## 快速开始（以 smart-trip 为例）

```bash
cd smart-trip
cp .env.example .env       # 填入 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DEFAULT_USER_ID
npm install
npm run build
```

然后用 `claude mcp add` 注册（**用户级**，所有工作目录都能用）：

```bash
# 家用 PC
claude mcp add -s user smart-trip -- node "E:/Project/mcp-servers/smart-trip/dist/index.js"

# 办公室 PC
claude mcp add -s user smart-trip -- node "D:/Projects/mcp-server/smart-trip/dist/index.js"
```

> `-s user` 是用户级；不带就是当前项目级。`--` 后面是子进程命令。绝对路径按机器替换。

确认：`claude mcp list` 应能看到 `smart-trip`。重启 Claude Code，新对话里 `/mcp` 应显示 `smart-trip ✓ 已连接`，工具列表里有 15 个 trip/day/stop/place 工具。

## 加新 app 的 MCP

```bash
cp -r _template my-app
cd my-app
# 改 package.json 里的 name / bin
# 改 src/index.ts 里的 server name
# 写工具（参考 smart-trip/src/tools/）
npm install && npm run build
```

然后用 `claude mcp add -s user my-app -- node "<当前机器绝对路径>/my-app/dist/index.js"` 注册，**重启 Claude Code**。

## 设计约定

- **协议**：MCP over stdio（Claude Code 把每个 server 当子进程拉起）
- **语言**：Node.js + TypeScript（统一一套生态，方便互相借鉴）
- **SDK**：`@modelcontextprotocol/sdk@^1.29.0`（v1 稳定，不用 v2 alpha）
- **校验**：`zod` 入参校验（v1 SDK 用 raw zod shape，不包 `z.object`）
- **机密**：每个 MCP 自己读 `.env`，不要把 secret 写进 `settings.json`
- **错误**：返回 `{ content: [...], isError: true }` 让 Claude 看到错误能自我纠正
- **日志**：必须 `console.error` 走 stderr，stdout 是 MCP 协议帧通道
