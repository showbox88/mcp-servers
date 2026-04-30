# `_template` — MCP server starter

Copy this folder, rename `REPLACE-ME` everywhere, write your tools.

## 用法

```bash
# 1. 复制并改名
cp -r _template my-app
cd my-app

# 2. 替换 REPLACE-ME 字符串
#   - package.json 的 name / bin / description
#   - src/index.ts 的 server name / 日志前缀

# 3. 装包 + 构建
npm install
npm run build

# 4. 注册到 Claude Code（见仓库根 README）
```

## 写工具

在 `src/index.ts` 里用 `server.tool(name, desc, zodShape, handler)`：

```ts
server.tool(
  'my_tool',
  'What this tool does',
  { foo: z.string(), bar: z.number().optional() },
  async ({ foo, bar }) => ({
    content: [{ type: 'text', text: `Got ${foo} ${bar ?? ''}` }],
  }),
);
```

工具数量多了就拆 `src/tools/*.ts`，参考 `smart-trip/` 的组织方式。
