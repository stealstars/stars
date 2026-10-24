# 领地档案 · Fief Ledger

SillyTavern（酒馆助手）脚本。把领地的建筑、军备、物产、账本、规划做成一本可查的册子，另带政令抽卡与外交情报。

**只读聊天与变量，不改世界书、不改正则。**

---

## 安装

1. 把 `loader.js` 里的 `OWNER` 改成你的 GitHub 用户名：

```js
const OWNER = 'YOUR_NAME';   // ← 改成你自己的
const REPO = 'fief-ledger';
```

2. 推到仓库后，把 `loader.js` 整个内容导入酒馆助手。

**只有这一步。** 以后改任何模块都不用重新导入。

---

## 改东西

```bash
# 改模块 → 打包 → 推
vim modules/core.js
node scripts/build.mjs --bump    # 版本 +1，重算 SHA-256，生成 manifest
git add -A && git commit -m "改了什么" && git push
```

用户那边刷新页面就生效。加载器会：

1. 拉 `manifest.json`（jsDelivr → GitHub raw 依次试）
2. 按 manifest 里的 SHA-256 逐个校验模块
3. 校验全通过才执行
4. 任何一步失败 → 回退上次成功的缓存

---

## 模块

| 文件 | 内容 | 什么时候改 |
|---|---|---|
| `modules/core.js` | 状态解析、面板、视图、读取回退 | 改面板结构、加新页 |
| `modules/policy.data.js` | 108 条政令，6 类各 18 条 | 改政令文字 |
| `modules/policy.css.js` | 政令抽卡样式 | 改卡片外观 |
| `modules/policy.ui.js` | 抽卡交互 | 改抽取规则 |
| `modules/ai.css.js` | AI 设置面板样式 | 改设置页外观 |
| `modules/ai.chan.js` | AI 调用通道 | 改请求逻辑 |
| `modules/ai.settings.js` | 凭据设置面板 | 改凭据界面 |
| `modules/prompts/*.js` | **提示词** | **改提示词只改这里** |

**模块顺序在 `scripts/build.mjs` 的 `MANIFEST` 数组里定死：数据 → 样式 → 界面 → 通道 → 主脚本。** 主脚本最后跑，因为它在启动时要读 `window.__fiefPolicy` 之类。

---

## 提示词

提示词单独成文件，不进主脚本。改完不用重导脚本。

```js
// modules/prompts/diplomacy.js
window.__fiefPrompts['外交'] = {
  system,      // 定身份、定规矩
  userBrief,   // 用户消息模板，{势力} {方向} 会被替换
  fields,      // 期望的 JSON 字段
  example,     // 少样本
  build(vars), // 把变量塞进模板
};
```

加新模块就加一个文件，在 `MANIFEST` 里排到 `core.js` 前面。

---

## AI 凭据

设置页 → API：

- **接口地址**：填 `https://host` 或 `https://host/v1` 都行，脚本自动补 `/v1/models` 与 `/v1/chat/completions`
- **API 密钥**：只存本机 `localStorage`（键 `fiefLedger.aichan.v1`），不写世界书、不进聊天、不随导出行走
- **拉取列表**：从 `/v1/models` 取，按负载排序（空闲 → 繁忙 → 未知 → 拥堵），标出单价 `×N`

支持任何 OpenAI 兼容接口。跨域需要对方带 `Access-Control-Allow-Origin`。

---

## 本地开发

```bash
node scripts/serve.mjs          # 静态服务器 http://127.0.0.1:8787/
node scripts/test.mjs           # 加载器 + 模块完整性测试
node scripts/test-prompt.mjs    # 用真实 API 跑提示词
```

测试会自己起服务器、拉每个模块、重算 SHA-256 比对、模拟篡改检测。

---

## 数据从哪来

五级回退：

1. **消息变量** —— MVU 的 `stat_data` 真正待的地方
2. **聊天变量**
3. **TavernHelper 消息接口**
4. **历史补丁** —— 重放 `<UpdateVariable>` 的 JSON Patch
5. **存档快照** —— 消息被删或重新生成后的最后一道

数据契约：`<fief_domain>` `<fief_report>` `<fief_build>`，按行首标签归类，不按字段序号套。

---

## 许可

自用脚本，随意改。
