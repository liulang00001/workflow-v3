# 节点类型（共 8 种）

## 1. find_event（事件定位）
在 CSV 中逐行扫描，找到满足条件的行。

阈值模式：
{
  "id": "node_1", "diagnosticType": "find_event",
  "label": "找到制动压力达标时刻",
  "x": 300, "y": 50,
  "findMode": "threshold",
  "conditions": [
    { "signalName": "BrkPdlDvrAppdPrs", "operator": ">=", "value": 2500 }
  ],
  "resultVar": "T1",
  "multiple": false,
  "next": "node_2",
  "onNotFound": "node_err"
}

conditions 中每个条件支持 transform 字段，用于在比较前对信号值做变换：
- "transform": "abs" 表示取绝对值后再用 operator 比较
例如检查"转向角绝对值大于90"：
{ "signalName": "StrgWhlAng", "operator": ">", "value": 90, "transform": "abs" }

**重要：不存在 "abs_gt" 等复合运算符，必须使用 transform + 标准 operator 的组合。**

跳变模式（单信号）：
{
  "findMode": "transition",
  "transition": { "signalName": "DrvrDoorOpenSts", "from": "!0", "to": 0 },
  "next": "node_2", "onNotFound": "node_err"
}

跳变模式（多信号 OR —— 任意一个信号发生跳变即匹配）：
{
  "id": "node_1", "diagnosticType": "find_event",
  "label": "找到最后一扇门关闭时刻",
  "x": 300, "y": 50,
  "findMode": "transition",
  "transitions": [
    { "signalName": "DrvrDoorOpenSts", "from": "!0", "to": 0 },
    { "signalName": "RLDoorOpenSts", "from": "!0", "to": 0 },
    { "signalName": "FrtPsngDoorOpenSts", "from": "!0", "to": 0 }
  ],
  "contextConditions": [
    { "signalName": "DrvrDoorOpenSts", "operator": "==", "value": 0 },
    { "signalName": "RLDoorOpenSts", "operator": "==", "value": 0 },
    { "signalName": "FrtPsngDoorOpenSts", "operator": "==", "value": 0 }
  ],
  "resultVar": "doorCloseEvents",
  "multiple": true,
  "next": "node_2",
  "onNotFound": "node_err"
}

transition/transitions 的 from 字段支持三种写法：
- "*"：匹配任意值（包括0→0，慎用）
- "!0"：匹配非0的值（即真正的跳变，推荐用于检测 非X→X 的场景）
- 具体值如 0, 1, 2：精确匹配

当需要检测"多个信号中任意一个发生跳变"时，使用 transitions 数组（OR 逻辑）替代单个 transition。
配合 contextConditions 确保跳变发生时其他相关信号也满足条件。

路由：next（找到时）, onNotFound（未找到时）

## 2. check_signal（单信号检查）
在指定时刻读取一个信号并判断。

{
  "id": "node_3", "diagnosticType": "check_signal",
  "label": "检查档位",
  "x": 300, "y": 200,
  "timeRef": "T1",
  "signalName": "TrShftLvrPos",
  "operator": "in",
  "value": [3, 4],
  "readResultVar": "gearValue",
  "onTrue": "node_4",
  "onFalse": "node_err2"
}

timeRef 支持以下写法：
- 变量名（如 "T1"）：引用之前 find_event 存储的行号
- "0" 或 "start"：数据第一行
- "last" 或 "end"：数据最后一行
- 数字字符串（如 "100"）：指定行号

当诊断流程不需要先定位事件、而是直接检查某个信号的整体状态时，
可以使用 timeRef: "0" 从第一行开始检查，或用 find_event 先定位关键事件行。

路由：onTrue, onFalse

## 3. check_multi_signal（多信号组合检查）
在指定时刻检查多个信号的 AND/OR 组合。

{
  "id": "node_5", "diagnosticType": "check_multi_signal",
  "label": "检查离车条件",
  "x": 300, "y": 350,
  "timeRef": "T1",
  "logic": "and",
  "checks": [
    { "signalName": "BCMDrvrDetSts", "operator": "==", "value": 0 },
    { "signalName": "EPTRdy", "operator": "==", "value": 0 }
  ],
  "onTrue": "node_6",
  "onFalse": "node_7"
}

checks 中也支持 "transform": "abs"，用于绝对值比较。不存在 "abs_gt" 运算符。

路由：onTrue, onFalse

## 4. scan_range（时间窗口扫描）
在时间窗口内检查条件是否 ever(曾经)/never(从未)/always(始终) 成立。

{
  "id": "node_8", "diagnosticType": "scan_range",
  "label": "检查8秒内蓝牙定位",
  "x": 300, "y": 200,
  "timeRef": "Ti",
  "offsetBefore": 0,
  "offsetAfter": 8,
  "scanMode": "always",
  "scanCondition": {
    "type": "signal",
    "signalName": "DigKey1Loctn",
    "operator": "in",
    "value": [0,1,2]
  },
  "resultVar": "inLockZone",
  "onTrue": "node_ok",
  "onFalse": "node_fail"
}

scanCondition 支持嵌套：
{
  "type": "and",
  "conditions": [
    { "type": "signal", "signalName": "X", "operator": "==", "value": 0 },
    { "type": "signal", "signalName": "Y", "operator": "==", "value": 0 }
  ]
}

路由：onTrue, onFalse

## 5. loop_scan（循环扫描）
从某时刻起逐行推进，多个检查项可分别触发不同的退出路径。

{
  "id": "node_10", "diagnosticType": "loop_scan",
  "label": "等待蓝牙定位",
  "x": 300, "y": 500,
  "timeRef": "Ti",
  "offsetStart": 9,
  "timeoutSeconds": 600,
  "loopChecks": [
    {
      "name": "基础条件",
      "condition": {
        "type": "and",
        "conditions": [
          { "type": "signal", "signalName": "DrvrDoorOpenSts", "operator": "==", "value": 0 },
          { "type": "signal", "signalName": "BCMDrvrDetSts", "operator": "==", "value": 0 }
        ]
      },
      "onFail": "node_basic_fail"
    },
    {
      "name": "蓝牙定位",
      "condition": {
        "type": "signal",
        "signalName": "DigKey1Loctn",
        "operator": "in",
        "value": [0,1,2]
      },
      "exitOnPass": true,
      "onPass": "node_lock_success"
    }
  ],
  "resultVar": "loopResult",
  "onTimeout": "node_bt_timeout"
}

路由：各 check 的 onFail/onPass，以及 onTimeout

## 6. switch_branch（多路分支）
读取信号值（或变量），根据值走不同路径。

{
  "id": "node_12", "diagnosticType": "switch_branch",
  "label": "判断状态",
  "x": 300, "y": 400,
  "switchSource": "signal",
  "timeRef": "T1",
  "switchSignalName": "AutoHoldSysSts",
  "readResultVar": "ahStatus",
  "cases": [
    { "values": [0], "next": "node_a", "label": "未开启" },
    { "values": [1], "next": "node_b", "label": "正常" },
    { "values": [2, 3], "next": "node_c", "label": "异常" }
  ],
  "defaultNext": "node_d"
}

## 7. foreach（遍历）
遍历数组变量中的每个元素，对每个元素执行一段子流程。

{
  "id": "node_20", "diagnosticType": "foreach",
  "label": "遍历每个关门事件",
  "x": 300, "y": 100,
  "listVar": "doorCloseEvents",
  "itemVar": "Ti",
  "bodyEntry": "node_21",
  "onComplete": "node_99"
}

子流程的末尾节点的 next 指回这个 foreach 节点的 id 即可继续下一次迭代。
路由：bodyEntry（循环体入口）, onComplete（遍历结束后）

## 8. output（结论输出）
输出诊断结论。message 支持 {{变量名}} 模板语法。

{
  "id": "node_30", "diagnosticType": "output",
  "label": "诊断结论",
  "x": 300, "y": 600,
  "outputType": "issue",
  "message": "离车未落锁原因：蓝牙钥匙断联（检测行: {{Ti}}）",
  "isTerminal": true
}

outputType: "issue"(问题), "info"(信息), "success"(正常)
isTerminal: true 表示到此结束整个流程；false 则通过 next 继续
路由：next（非终结时）

# 节点类型选择指南（选错类型是最常见的错误，请务必仔细判断）

## find_event vs check_signal（最容易混淆）

| 特征 | find_event | check_signal |
|------|-----------|--------------|
| 操作 | 逐行扫描整个数据集，找到满足条件的行 | 在已知的某一行读取信号值并判断 |
| 前提 | 不知道事件发生在哪一行 | 已经知道要看哪一行（有 timeRef） |
| 典型措辞 | "是否发生过"、"是否曾经触发"、"查看是否出现过" | "在该时刻检查"、"此时的值是多少" |

**判断规则**：如果诊断步骤的本质是"在整个数据中查找某个事件是否发生过"，即使措辞是"查看X是否等于Y"，也必须使用 find_event。只有当已经有一个确定的时间点（来自之前 find_event 的 resultVar），需要在该时刻读取信号值时，才使用 check_signal。

## find_event vs check_multi_signal（同样容易混淆）

check_multi_signal 仅用于"在已知的某一行，同时检查多个信号"。
如果诊断步骤是"在全数据中查找是否存在某行满足多个条件之一"，必须使用 find_event，不能用 check_multi_signal。

典型错误场景：文档说"查看DDC数据：加速踏板>85 或 转向角速度绝对值>200 或 转向角度绝对值>90"
- ❌ 错误：用 check_multi_signal + timeRef:"start"（只看第一行，可能错过后续行满足条件的情况）
- ✅ 正确：用 find_event + findMode:"threshold" + conditions（扫描全数据），多个条件用 OR 逻辑时，可以拆成多个 find_event 分别查找，或使用单个 find_event + conditions 配合后续节点分析

**核心原则：timeRef:"start"/"0" 只应用于检查数据的初始状态（如系统初始模式），不能用于"在全数据中搜索是否出现过某条件"的场景。**

## find_event vs scan_range

| 特征 | find_event | scan_range |
|------|-----------|------------|
| 目的 | 定位事件发生的具体行号 | 在已知时间窗口内检查条件是否 ever/never/always 成立 |
| 输出 | 行号（存入 resultVar） | 布尔值（满足/不满足） |
