# smart-trip-mcp

让 Claude Code 直接读写你 Smart Trip 数据的 MCP server。绕过 React UI，直连 Supabase（service role）。

## 暴露的工具（15 个）

| 类别 | 工具 |
|---|---|
| 行程 | `list_trips` `get_trip` `create_trip` `update_trip` `delete_trip` `clone_trip` |
| 天数 | `add_day_to_trip` `update_day` `remove_day` |
| 站点 | `add_stop` `add_stops_bulk` `update_stop` `remove_stop` `reorder_stops` |
| 地点 | `search_places` |

新增工具说明：
- **`clone_trip(source_trip_id, new_title, new_start_date, new_thumb?)`** — 复制行程到新日期。所有 days 按 `new_start_date - source.start_date` 偏移；stops_data 深拷贝、stop id 重新生成；新 days 是独立行（不共用 source）。如果新日期跟你已有的 days_v2 行冲突（UNIQUE user_id+date）会失败并报告冲突日期。
- **`add_stops_bulk(day_id, stops[])`** — 一次追加 N 个站点，单次 Supabase 写入。
- **`reorder_stops(day_id, from_index, to_index)`** — 在同一天内移动站点位置。索引以移动前的数组为准。

> 当前只读写 v2 数据（`trips.trip_data IS NULL`），不碰老的 v1 行程。

## 安装

```bash
cd <仓库路径>/smart-trip   # 家用 PC: E:/Project/mcp-servers/smart-trip
                           # 办公室 PC: D:/Projects/mcp-server/smart-trip
cp .env.example .env
# 编辑 .env 填入两个值（见下面 — SUPABASE_URL 已预填）
npm install
npm run build
```

## 环境变量（`.env`）

| 变量 | 怎么取 |
|---|---|
| `SUPABASE_URL` | 从 Smart-Trip 项目的 `.env` 复制 `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | https://supabase.com/dashboard → 你的项目 → **Settings → API → service_role** secret |
| `DEFAULT_USER_ID` | Supabase Dashboard → **Authentication → Users** → 点你的账号 → 复制 **User UID** |

⚠️ **service_role key 等同 root**——绕过所有 RLS。不要进 git、不要贴聊天、不要给前端用。

## 注册到 Claude Code

在 PowerShell 或终端跑（按机器替换绝对路径）：

```powershell
# 家用 PC
claude mcp add -s user smart-trip -- node "E:/Project/mcp-servers/smart-trip/dist/index.js"

# 办公室 PC
claude mcp add -s user smart-trip -- node "D:/Projects/mcp-server/smart-trip/dist/index.js"
```

> `-s user` = 用户级（所有项目都能用），不带 `-s` 是项目本地。
> `--` 之后是子进程命令；node 必须在 PATH。
> 多机情况下两台机器各自注册一次，写入各自 `~/.claude.json`，路径独立。

确认：`claude mcp list` 看到 `smart-trip`，再 `claude mcp get smart-trip` 看到 ✓ Connected。

**重启 Claude Code**（关闭再开），新对话里 `/mcp` 应显示 `smart-trip` 已连接。

## 试一下

直接和 Claude Code 对话：

- "**列出我所有的行程**" → 调 `list_trips`
- "**新建一个 5 月 1 日到 5 月 3 日的东京 3 日游**" → `create_trip` + 3 次 `add_day_to_trip`
- "**给我东京行程的 5 月 1 日加一个浅草寺站点**" → `get_trip` 找到 day_id，再 `add_stop`
- "**查一下"清水寺"在不在已缓存的地点里**" → `search_places`

打开 Smart Trip Web UI（`npm run dev`）刷新看板，新数据应该出现，证明 MCP 和 React 走的是同一份真相。

## 调试

- **`claude mcp list` 看不到**：确认是用 PowerShell 跑的（不是 bash 里 `claude` 不存在）；或者用绝对路径 `& "C:\Program Files\nodejs\..." mcp add ...`。
- **`/mcp` 里红叉**：`claude mcp get smart-trip` 看错误；多半是 `dist/index.js` 路径错或 `npm run build` 没跑。
- **`Missing env`**：`.env` 必须在仓库根（`smart-trip/.env`），不是在 `dist/` 里。`index.ts` 走 `resolve(here, '..', '.env')` 已处理。
- **`row violates row-level security`**：service_role key 配错了（用了 anon），重新去 Supabase Dashboard 抓。
- **写入成功但 React UI 看不到**：`DEFAULT_USER_ID` 不是你登录账号的 UID，去 Supabase Auth 页面对一下。
- **想反悔**：`claude mcp remove -s user smart-trip` 注销。

## 远程部署（Phase 1：HTTP + Tailscale Funnel）

把 MCP 从本地 stdio 升级成"办公室一台 24/7 Linux VM 跑 HTTP，Claude.ai web/mobile 通过 Tailscale Funnel 调用"。这样 Claude Code 不用挂 smart-trip MCP（解放 context），出门也能用。

### 架构

```
办公室 Proxmox 主机
└── Linux VM
    ├── Node + smart-trip MCP HTTP server（监听 127.0.0.1:3001）
    ├── systemd 守护
    └── tailscale daemon (现有 tailnet)
            │
            └─ tailscale serve + funnel
                    │
                    ↓
   公网 https://<vm-name>.<tailnet>.ts.net
                    │
                    │  HTTPS + Bearer token
                    │
   ┌────────────────┼────────────────────┐
Claude Code     Claude.ai 网页       Claude.ai 手机
（任何机器）    （任何浏览器）        （中文打字）
```

### 一次性部署步骤（Linux VM 上，~1 小时）

```bash
# 1. 系统准备（Debian 12 / Ubuntu 24.04）
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
curl -fsSL https://tailscale.com/install.sh | sudo bash
sudo tailscale up                # 浏览器登录加入 tailnet

# 2. 部署用户和目录
sudo useradd -r -s /usr/sbin/nologin -d /opt/mcp-servers mcp
sudo mkdir -p /opt/mcp-servers && sudo chown mcp:mcp /opt/mcp-servers
sudo -u mcp git clone https://github.com/showbox88/mcp-servers.git /opt/mcp-servers

# 3. 安装 smart-trip
cd /opt/mcp-servers/smart-trip
sudo -u mcp cp .env.example .env
sudo -u mcp nano .env            # 填 SUPABASE_SERVICE_ROLE_KEY / DEFAULT_USER_ID / MCP_BEARER_TOKEN
sudo -u mcp npm install
sudo -u mcp npm run build

# 生成 bearer token（如果没填）
openssl rand -hex 32             # 复制粘进 .env 的 MCP_BEARER_TOKEN

# 4. 启动 systemd 服务
sudo cp systemd/smart-trip-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now smart-trip-mcp
sudo systemctl status smart-trip-mcp        # 应显示 active (running)
curl -s http://127.0.0.1:3001/healthz       # 应返回 {"ok":true,"service":"smart-trip-mcp","tools":15}

# 5. Tailscale Funnel 暴露公网
sudo tailscale serve --bg --https=443 http://localhost:3001
sudo tailscale funnel --bg 443
sudo tailscale funnel status                # 看到 https://<vm-name>.<tailnet>.ts.net

# 6. 公网验证
curl https://<vm-name>.<tailnet>.ts.net/healthz
```

### 注册到 Claude.ai（要求 Pro / Max / Team）

1. 打开 https://claude.ai → 右下角头像 → **Settings** → **Connectors**
2. **Add custom connector**
3. 填：
   - **Name**：`smart-trip`
   - **Server URL**：`https://<vm-name>.<tailnet>.ts.net/mcp`
   - **Authentication**：Bearer Token，粘贴 `.env` 里的 `MCP_BEARER_TOKEN`
4. 保存。新对话里说"列出我所有的行程"应能调通。

### 注册到 Claude Code（HTTP 模式，可选）

如果想从某台 Claude Code 远程用同一份 HTTP 服务（不再启本地 stdio）：

```bash
claude mcp remove -s user smart-trip       # 先移除 stdio 版（如有）
claude mcp add --transport http -s user smart-trip \
  https://<vm-name>.<tailnet>.ts.net/mcp \
  -H "Authorization: Bearer <token>"
```

### 日常运维

| 操作 | 命令 |
|---|---|
| 看日志 | `sudo journalctl -u smart-trip-mcp -f` |
| 重启 | `sudo systemctl restart smart-trip-mcp` |
| 升级（拉新工具） | `cd /opt/mcp-servers && sudo -u mcp git pull && cd smart-trip && sudo -u mcp npm install && sudo -u mcp npm run build && sudo systemctl restart smart-trip-mcp` |
| 旋转 token | 改 `.env` 的 `MCP_BEARER_TOKEN` → `systemctl restart` → Claude.ai connector 设置同步更新 |
| 关 funnel | `sudo tailscale funnel --bg 443 off` |

### 安全注意

- **bearer token 是唯一的访问控制**——泄露 = 任何人能读写你 Smart Trip 数据。立刻旋转。
- **service_role 在 VM 内**，不出户；这是不上 Vercel/Fly 的核心收益
- **/healthz 不带 auth**，但只回固定 JSON，不泄露任何东西
- Funnel 流量限制：免费个人版 1000GB/月，远超个人用量
- VM 防火墙不需要开 inbound 端口——Funnel 出方向打洞

## 设计要点

- **id 格式**：`trip-${Date.now()}` / `day-${Date.now()}-${rand}` —— 与 Smart Trip React 端一致
- **v1/v2 隔离**：所有 list/get 都加 `.is('trip_data', null)`
- **`days_v2` 唯一约束**：`UNIQUE(user_id, date)` — `add_day_to_trip` 用 `upsert(onConflict='user_id,date')`，对同一日期重复调用是幂等的
- **`stops_data` 是 JSONB 数组**：read-modify-write，**单用户单进程下安全**；多用户/多 Claude Code 进程下会有 lost-update，二期再处理
- **照片**：`thumb` 默认用 Smart Trip 用的 Unsplash 图，stops 照片字段只接 URL，**不上传 Supabase Storage**
- **未来 Phase B**：当 Smart Trip 把 `stops_data` 拆成独立 `stops` 表（见 `Smart-Trip/docs/database_migration_plan.md`），这里 stops 工具要改写底层 SQL，工具签名保持不变即可
