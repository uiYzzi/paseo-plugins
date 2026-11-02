# @uiyzzi/paseo-codexbar-usage

把 [CodexBar](https://github.com/steipete/CodexBar) 里启用的 provider 额度塞进 Paseo 的用量页。插件在 daemon 上跑 CodexBar 自带的 CLI，不需要 `codexbar serve`。

## 装

```bash
paseo plugin install ./packages/codexbar-usage
```

改完源码后：

```bash
npm run typecheck -w packages/codexbar-usage
paseo plugin reload paseo-codexbar-usage
```

## 行为

- 主体是 server 侧 `registerUsageSource`；客户端只多一个设置页（`addSettingsScreen`）。
- 设置页显示 CLI 是否找到、版本、已启用的 provider，并且可以填 CLI 完整路径；没装 CodexBar 时这里会直接提醒并给出下载链接。
- CLI 查找顺序：`CODEXBAR_BIN` → PATH 上的 `codexbar` → `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI` → 设置页里填的路径。
- CodexBar 里 `enabled: true` 的每个 provider 注册成**独立**的 usage source（id `codexbar-<provider>`），label 用 `codexbar dashboard` 里的 `name`，所以卡片标题是 `Kimi Code` / `DeepSeek`。
- 窗口的 label / 已用百分比 / 重置时间 / tone 来自 `codexbar dashboard`；余额文案（DeepSeek 的 `¥73.22 (Paid: …)`）和 pace 余量来自 `codexbar usage --format json`，落在详情行。
- 内置 provider 走 `codexbar dashboard` + `codexbar usage --format json`；自己装的 provider 插件走 `codexbar plugins list` + `codexbar plugins fetch <id> --json`（`dashboard` 不列插件 provider，`usage --provider <插件 id>` 会默默返回全部内置 provider，所以两者必须分开）。
- 插件 provider 的窗口、`providerCost`（USD 余额条）、`details[].rows`（详情行）、`loginMethod`（plan 微标）分开映射。
- 会话弹层：把会话 provider 拆成候选 id（`pi/deepseek/deepseek-flash` → `deepseek`；`pi/zenai/...` → `zenai`；`codex` → `codex`），命中才返回数据。
- CLI 查找顺序：`CODEXBAR_BIN` → PATH 上的 `codexbar` → `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI` → 设置页里填的路径。
- `dashboard` 结果在进程内缓存 20 秒（discover 和紧随其后的 fetch 共用一次调用），Paseo 自己对每个账户再缓存 5 分钟。

## 遇到的坑

- **注册必须同步**。daemon 在 `contribute()` 返回后立刻读注册表（`plugin-process.ts` 的 `initialize`：`contribute()` 不 await，紧接着发 `ready`），所以异步注册的 source 会被静默丢掉。provider 名字因此要在启动时用 `execFileSync` 同步拿；阻塞的只是插件子进程。副作用：设置里的 `cliPath` 在启动时还读不到（`registerSettings` 只有异步 `read()`），所以它只能当兜底，改完必须重载插件。
- `codexbar usage` 的 JSON 没有 provider 显示名，也没有 `remainingPercent`；`codexbar dashboard` 两者都有，但缺 pace 和余额文案。所以 fetch 里两条命令并行跑，各补对方缺的字段。
- `codexbar dashboard` 不含自定义 provider 插件，`usage --provider <插件 id>` 也不报错——它会把所有内置 provider 都吐回来。所以插件 provider 必须走 `plugins fetch`，而 `readUsage` 找不到精确匹配时返回 null，不能拿 `rows[0]`。
- 插件 provider 的 `providerCost` 只有 USD 能映射成 Paseo 的 `usd` 类型，其他币种降级成 `credits`（Paseo 的 `UsageBalance.unit` 只认 usd/credits/requests/tokens）。
- `dashboard` 的 `kind` 描述的是槽位不是窗口时长：Kimi 的 5 小时窗口标成 `weekly`，余额窗口标成 `session`。`shortLabel` 优先用 `usage` 里的 `windowMinutes`，其次从 label 里解析，余额/credit 一律不给短标签。
- CodexBar 的 `pi` provider 指的是 Pi 订阅本身，和 `pi/deepseek/...` 这种会话跑的不是同一个账户，所以 `pi`/`omp` 前缀的会话只认 vendor 段。
- `CodexBar.app` 里没有 `codexbar://` URL scheme，也没有 socket / XPC 接口，程序接口是包内的 `Contents/Helpers/CodexBarCLI`（13 个子命令）和 `codexbar serve` 那个 HTTP 服务。
- daemon 的 PATH 往往很短，所以默认走 App 包里的绝对路径，而不是依赖 `codexbar` 在 PATH 上。
