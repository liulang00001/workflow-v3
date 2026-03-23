# Workflow Analyzer V2

自然语言 → TypeScript 代码 → 流程图 → 执行分析

## 架构

```
用户输入自然语言
       ↓
  /api/generate → LLM → TypeScript 分析函数
       ↓
  /api/parse-ast → ts-morph AST 解析 → 流程图节点/边
       ↓
  用户可编辑代码 ←→ 流程图可视化（双向联动）
       ↓
  上传 Excel + /api/execute → Function 沙箱执行 → 结果面板
```

### 核心设计

| 层 | 技术 | 说明 |
|---|------|------|
| LLM 生成 | TypeScript 代码 | 比复杂 JSON DSL 稳定，不截断、不丢字段 |
| 流程图 | ts-morph AST 自动解析 | if→条件节点，for→循环节点，函数调用→动作节点 |
| 编辑器 | Monaco Editor | 支持语法高亮、点击流程图节点高亮对应代码 |
| 流程图渲染 | @xyflow/react (React Flow) | 5种自定义节点：start/end/condition/action/loop |
| 执行 | Function 沙箱 | 受控作用域，console.log 自动捕获为日志 |

### 与 V1 对比

| | V1 | V2 |
|---|---|---|
| LLM 输出 | 复杂 JSON DSL（500+行，常截断） | TypeScript 代码（100-200行） |
| 流程图来源 | JSON 中手写节点坐标 | AST 自动解析 + 自动布局 |
| 执行引擎 | 手写 while 循环 + if 分支（1500行） | `new Function()` 直接执行（50行） |
| 代码↔流程图 | 单向（JSON→渲染） | 双向（节点→高亮代码，改代码→重新解析） |
| debug | 巨大 JSON 快照 | console.log 自动捕获 |

## 项目结构

```
workflow-v2/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
│
├── src/
│   ├── lib/
│   │   ├── types.ts              # 核心类型：FlowNode, FlowEdge, DataTable, ExecutionResult
│   │   ├── prompts.ts            # LLM 系统提示词（指导生成 TypeScript 分析函数）
│   │   ├── ast-parser.ts         # ts-morph AST 解析：代码控制流 → 流程图
│   │   └── executor.ts           # 安全执行器：类型清理 + Function 沙箱 + console 捕获
│   │
│   ├── components/
│   │   ├── CodeEditor.tsx        # Monaco 编辑器，支持行高亮联动
│   │   ├── FlowChart.tsx         # React Flow 流程图，5种自定义节点
│   │   └── ResultPanel.tsx       # 结果面板：发现列表 + 时间轴 + 执行日志
│   │
│   └── app/
│       ├── page.tsx              # 主页面：左侧输入 + 右侧三 tab（代码/流程图/结果）
│       ├── layout.tsx
│       ├── globals.css
│       └── api/
│           ├── generate/route.ts     # NL → TypeScript 代码
│           ├── parse-ast/route.ts    # 代码 → 流程图（AST）
│           └── execute/route.ts      # 执行代码 + 数据 → 结果
```

## 快速开始

```bash
# 安装依赖
npm install

# 配置 LLM API（创建 .env.local）
echo "LLM_API_KEY=your-api-key" >> .env.local
echo "LLM_API_BASE=https://api.openai.com/v1" >> .env.local
echo "LLM_MODEL=gpt-4o" >> .env.local

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000

## 使用流程

1. **描述需求**：在左侧输入框用自然语言描述分析逻辑
2. **生成代码**：点击"生成分析代码"，LLM 生成 TypeScript 函数
3. **查看/编辑**：在"代码"tab 查看和修改代码，"流程图"tab 查看自动生成的流程图
4. **上传数据**：点击"上传数据"上传 Excel 信号数据
5. **执行分析**：点击"执行分析"，查看结果面板中的发现、时间轴和日志

## LLM 生成的代码示例

LLM 会生成类似这样的 TypeScript 函数（取代旧版数百行 JSON）：

```typescript
function allDoorsClosed(row) {
  return row.DrvrDoorOpenSts === 0
    && row.FrtPsngDoorOpenSts === 0
    && row.RLDoorOpenSts === 0
    && row.RRDoorOpenSts === 0
    && row.LdspcOpenSts === 0;
}

function analyze(data) {
  const findings = [];
  for (let i = 1; i < data.length; i++) {
    if (!allDoorsClosed(data[i - 1]) && allDoorsClosed(data[i])) {
      // 分析逻辑...
    }
  }
  return { findings, summary: '...' };
}
```

AST 解析器会自动将其转换为流程图：
- `allDoorsClosed` → 动作节点
- `for` 循环 → 循环节点
- `if` 判断 → 条件节点（带 是/否 分支）
- 流程图节点可点击，高亮对应源码行
