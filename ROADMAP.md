# 长期规划备忘 — 私人智能体生态

> 本文档记录的是**战略层面**的思考和决定，不是实施手册。实施细节看各 app 的 README / `_template`。
> 写于 2026-04-30，第一个 MCP（smart-trip）落地当天。

---

## 愿景一句话

**做一个连通自己所有 app 的私人智能体。在家用电脑文字/语音，出门用手机也能调用同一套 app 能力。**

---

## 核心心智模型

```
┌────────────────────────────────────────────────┐
│  各 app 的能力层 (MCP servers)                  │
│  smart-trip / voice / music / price-track / …  │
└──────────────────────┬─────────────────────────┘
                       │ MCP 协议
   ┌───────────────────┼───────────────────┐
   │                   │                   │
 Claude Code      Claude.ai web         自己的 hub
 (PC, 已用)        (手机, 备选)         (自定义, 终极)
```

**关键不变量**：MCP 工具一旦写好，**所有客户端共享**，未来换前端不丢工作。

**所以决策永远围绕一个问题**：这件事属于"工具层"（写进 MCP，长期资产）还是"客户端层"（暂时方案，可丢弃）？

---

## 当前状态（Phase 0 完成）

- ✅ `E:\Project\mcp-servers\` 目录骨架 + `_template` 复制模板
- ✅ smart-trip MCP（12 个工具：trip / day / stop / place）
- ✅ stdio 传输，注册到 Claude Code 用户级
- ✅ 单租户：`SUPABASE_SERVICE_ROLE_KEY` + `DEFAULT_USER_ID`，绕过 RLS
- ✅ 端到端验证：`list_trips` 真读到了用户 4 个 v2 trip

**已做的关键设计决定**（不要轻易反悔）：

| 决定 | 理由 | 反悔代价 |
|---|---|---|
| Node + TypeScript 统一栈 | Smart Trip 自己用 Node；Voice/World Monitor 也是 | 中（但跨 app 维护成本下降）|
| `@modelcontextprotocol/sdk` v1 stable，不用 v2 alpha | v2 还在 alpha | 低（升级时跟着 SDK 走）|
| stdio 传输 | 本地、零运维、无需鉴权 | 中（要改 HTTP 时每个 MCP 都要改）|
| service_role + 单租户 | 简单，本地秘密 | 高（升 HTTP/上云时必须改成 OAuth）|
| MCP 直连 Supabase，绕过 React | 不修 Smart Trip 代码 | 低（双向真相，React 改 schema 时需同步）|
| MCPs 集中放 `E:\Project\mcp-servers\`，独立于 app 仓库 | app 升级 ≠ MCP 升级 | 低 |

---

## 路线图

### Phase 0+：把 smart-trip 真的用起来（NOW）

**目标**：累积"什么工具不够用 / 什么场景没覆盖"的真实反馈。

不要做：
- 不要急着接下一个 app
- 不要急着上 HTTP / 部署
- 不要急着做手机端

要做：
- 用 smart-trip 规划真实行程（比如那个秋季西班牙+中国 1.5 月）
- 发现缺工具就加（如 `add_destination`、按区域筛选、批量改）
- 发现 schema 不顺手就记下来（喂回 `Smart-Trip/docs/database_migration_plan.md` 的 Phase B）

**时长**：用一两周。

---

### Phase 0++：Voice 接进来（下一个 MCP，可选）

**为什么这个先**：Voice 已经有 STT + Google Calendar，是你**最重要的资产**。把它的能力暴露成 MCP，就能"用语音把一段录音的内容自动落到 smart-trip"——闭环了。

**潜在工具**：
- `transcribe(audio_id)` 取最近一段录音的转写
- `list_recent_recordings(limit)` 列最近录音
- `extract_calendar_events_from_transcript(transcript)` 从转写里抽出日期/地点
- `link_recording_to_trip(recording_id, trip_id)` 关联录音到行程

**复杂度**：中。Voice 是 Electron 内部 IPC，需要先看它有没有可调用的 API 层（HTTP？文件系统读取？SQLite？）。

---

### Phase 1：HTTP 化 + 简单手机访问（1-2 小时）

**触发条件**：你出门时真的想到"哎要是现在能加个 stop 就好了"，**且这种场景一周发生 3 次以上**。

**改动**：
- MCP 服务端：`StdioServerTransport` → `StreamableHTTPServerTransport`
- 部署：Vercel / Fly.io / Railway 单人免费层
- 鉴权：单一 API token，请求头带 `Authorization: Bearer xxx`
- service_role：搬到部署平台环境变量
- 在 Claude.ai web/mobile 设置里注册 HTTPS endpoint

**隐患**：
- service_role 上云的安全代价
- Supabase 项目如果加了 IP 白名单，Vercel 出口 IP 不在内
- 冷启动延迟 200-500ms

**为什么不一开始就做**：你不一定会用到。先观察。

---

### Phase 2：自己的 always-on agent + 手机 app（终极形态）

**触发条件**：Phase 1 用过、知道哪些场景真高频，且想要更深的能力（proactive 通知、上下文持久化、隐私敏感）。

**架构**：

```
家里某台机器 (NAS / 老笔记本 / Pi)
├── always-on agent (Claude Agent SDK)
│   ├── 加载所有 MCPs
│   ├── 持久化对话上下文
│   └── 暴露 HTTPS API
└── Tailscale (或 Cloudflare Tunnel)
        ▲
        │ 加密内网
        ▼
手机 app (Capacitor，复用 Smart Trip 工程经验)
├── 聊天 UI
├── 麦克风录音 (复用 Voice 的 STT)
└── 调家里 agent
```

**关键资产复用**：
- Voice 的 STT → 手机端语音输入
- Smart Trip 的 Capacitor 打包经验 → 手机壳
- 现有 MCPs → 后端能力层

**为什么这条路最适合你**（不是空话）：
- 大部分人卡在"语音输入怎么做"——你已经做完了
- 大部分人卡在"怎么打包成手机 app"——你已经会了
- 数据全自己掌握，不上 SaaS

**时长**：2-4 周深度投入；但不必一次做完，可以拆 sprint。

---

### Phase 3+：未来再说的事

- **唤醒词 / 常驻语音**（"Hey Smart"）
- **proactive 通知**（agent 主动 push）
- **多设备一致性**（家人共用？）
- **离线模式**（飞机上能看行程）
- **多模态**（拍照传给 agent 解析菜单/票据）

---

## 待接入 MCP 池（按价值-成本排序）

| MCP | 价值 | 复杂度 | 备注 |
|---|---|---|---|
| **smart-trip** | ✅ 已做 | — | — |
| **scheduled-tasks** | 高 | ✅ Claude Code 内建 | 不用做，直接说"明天 3 点提醒我" |
| **voice** | 高 | 中 | Electron 内部接口要看；做完闭环巨大 |
| **music-player** | 中 | 低 | E:\Project\MP3 文件夹+ mpv/foobar 远程控制 |
| **flight-tracker** | 中-高 | 高 | 全新 app + 数据源（Skyscanner API / 抓包） |
| **item-price-tracker** | 中 | 中 | 有现成开源（如 keepa for Amazon） |
| **world-monitor** | 中 | 中 | 已有 Vercel Edge endpoints，封装成 MCP 容易 |
| **trip-photo-archive** | 低-中 | 中 | 你 settings.json 里有这个目录，问 future you |

**原则**：每加一个 MCP 之前，问自己"我会真的用这个 ≥ 每周 1 次吗？"——不会就不做，避免过度膨胀。

---

## 待决定 / 待观察的事

1. **Smart Trip Phase B schema 重构**（参见 `Smart-Trip/docs/database_migration_plan.md`）何时执行？
   - 当 Smart Trip 真的执行 4 表规范化（stops 独立成表），smart-trip MCP 的 stops 工具底层 SQL 要重写
   - 工具签名（add_stop / update_stop 入参）保持不变，**对 Claude 透明**——这是 MCP 抽象的好处

2. **Trip-Photo-Archive 跟 Smart Trip 的关系**？
   - settings.json 里有它的路径，但还没探索
   - 它跟 Smart Trip 共享 Supabase 项目吗？还是独立？
   - 未来要不要做一个 photo-archive MCP？

3. **多用户 / 共享行程**
   - 现在单租户够用
   - 如果家人也要用，需要 OAuth + per-user state，回到 service_role 的根本问题
   - 不是现在的事

4. **MCP server 加 git？**
   - 现在 `E:\Project\mcp-servers\` 没初始化为 git 仓库
   - 加 git 好处：版本回溯、跨机同步
   - .env 已 gitignore，安全
   - 要不要加？看你的多机使用频率

5. **HTTP 化的 service_role 安全方案**
   - 如果走 Phase 1，需要把 service key 上云
   - 替代：把 MCP 跑在 Tailscale 私网内的家用机器上，从手机 Claude.ai 链接 Tailnet IP
   - 这条路不解决"出差不在家"的场景，但解决 70% 案例

---

## 不要做的事（同等重要）

- ❌ **不要把 settings.json 当 mcp 配置**——那是 Claude Code 的设置，MCP 走 `claude mcp add` 或 `~/.claude.json`
- ❌ **不要把 service_role 写进 settings.json / 提交到 git**
- ❌ **不要现在就接 5 个 app**——一个 MCP 用透再下一个
- ❌ **不要为了"未来手机用"现在就上 HTTP**——用了再说
- ❌ **不要在 React 端和 MCP 端写两份相似逻辑**——MCP 直连数据，业务规则只在 Smart Trip React 里

---

## 检查清单（每隔 1-2 个月回看一次）

- [ ] smart-trip MCP 真的在用吗？还是只跑过几次玩具调用？
- [ ] 有没有发现工具不够用的情况？记下来加
- [ ] Smart Trip Phase B schema 迁移有进展吗？
- [ ] 出门时真有"想用 agent 但用不了"的痛点吗？哪些场景？
- [ ] 是不是该接 Voice MCP 了？Voice 本身有需要先重构的吗？
- [ ] `_template` 的样板代码还合适吗？（SDK 升级了？最佳实践变了？）

---

## 相关文件索引

- 实施方案（已完成）：`C:\Users\showb\.claude\plans\app-app-ticklish-cosmos.md`
- 总入口手册：`E:\Project\mcp-servers\README.md`
- smart-trip 详细文档：`E:\Project\mcp-servers\smart-trip\README.md`
- Smart Trip Phase B 重构计划：`Smart Trip\Smart-Trip\docs\database_migration_plan.md`
- 模板：`E:\Project\mcp-servers\_template\`
