# smart-trip-mcp

让 Claude Code 直接读写你 Smart Trip 数据的 MCP server。绕过 React UI，直连 Supabase（service role）。

## 暴露的工具（12 个）

| 类别 | 工具 |
|---|---|
| 行程 | `list_trips` `get_trip` `create_trip` `update_trip` `delete_trip` |
| 天数 | `add_day_to_trip` `update_day` `remove_day` |
| 站点 | `add_stop` `update_stop` `remove_stop` |
| 地点 | `search_places` |

> 当前只读写 v2 数据（`trips.trip_data IS NULL`），不碰老的 v1 行程。

## 安装

```bash
cd E:/Project/mcp-servers/smart-trip
cp .env.example .env
# 编辑 .env 填入三个值（见下面）
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

在 PowerShell 或终端跑：

```powershell
claude mcp add -s user smart-trip -- node "E:/Project/mcp-servers/smart-trip/dist/index.js"
```

> `-s user` = 用户级（所有项目都能用），不带 `-s` 是项目本地。
> `--` 之后是子进程命令；node 必须在 PATH。

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

## 设计要点

- **id 格式**：`trip-${Date.now()}` / `day-${Date.now()}-${rand}` —— 与 Smart Trip React 端一致
- **v1/v2 隔离**：所有 list/get 都加 `.is('trip_data', null)`
- **`days_v2` 唯一约束**：`UNIQUE(user_id, date)` — `add_day_to_trip` 用 `upsert(onConflict='user_id,date')`，对同一日期重复调用是幂等的
- **`stops_data` 是 JSONB 数组**：read-modify-write，**单用户单进程下安全**；多用户/多 Claude Code 进程下会有 lost-update，二期再处理
- **照片**：`thumb` 默认用 Smart Trip 用的 Unsplash 图，stops 照片字段只接 URL，**不上传 Supabase Storage**
- **未来 Phase B**：当 Smart Trip 把 `stops_data` 拆成独立 `stops` 表（见 `Smart-Trip/docs/database_migration_plan.md`），这里 stops 工具要改写底层 SQL，工具签名保持不变即可
