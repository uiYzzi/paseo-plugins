# CodexBar 用量

把 CodexBar 里跟踪的每个 provider 加进 Paseo 的用量页，菜单栏里盯着的额度，在 agent 旁边也能看到。鉴权和轮询都还由 CodexBar 负责，插件只读它已经知道的东西。

## 怎么工作

插件在 daemon 机器上跑 CodexBar 自带的 CLI，把结果映射成 Paseo 的用量来源。CodexBar 里启用的每个 provider 独占一张卡片，卡片标题用 CodexBar 里的 provider 名字，所以页面上看到的是 `Kimi Code`、`DeepSeek`，而不是统一的 `CodexBar`。窗口的标签、已用百分比、重置时间、告警都保留；CodexBar 打印的余额和 pace 那一行变成进度条下面的详情行。

打开某个会话的用量弹层时，插件会去找那个会话所用的登录。会话的 provider 和 CodexBar 的 provider 对得上，就显示对应数字；对不上就什么都不显示。

CLI 优先取 CodexBar App 包里的那个，找不到再用 daemon PATH 上的 `codexbar`。

## 配置

在 daemon 机器上装 CodexBar，并在它的设置里启用你在意的 provider。插件依次找 daemon PATH 上的 `codexbar`、CodexBar.app 里的 CLI、以及设置页里填的路径。Paseo 在插件启动时读一次 provider 列表，所以在 CodexBar 里增删 provider 之后要重载插件才同步。

不想用设置页时，可以用 `CODEXBAR_BIN` 指定 CLI。CLI 完全跑不起来时，用量页会出现一张带错误信息的 CodexBar 卡片，而不是什么都不显示。

## 设置

设置 → 插件 → CodexBar 用量：显示有没有找到 CLI、启用了哪些 provider，并且在 PATH 和 App 包都没有时，可以填 CLI 的完整路径。改完路径要重载插件，provider 卡片才会重新注册。

## 权限与限制

插件以你在 daemon 机器上的权限运行。它会执行 CodexBar 的 CLI，由 CLI 读取 CodexBar 自己的配置和凭据，并可能访问 provider 的 API；插件本身不发网络请求，也不存任何东西。

数字的新鲜程度取决于 CodexBar 上一次刷新，再加上 Paseo 对每个账户五分钟的缓存，所以进度条可能比菜单栏慢几分钟。在应用里刷新只是取 CodexBar 当前的缓存，不会强制重新拉取。CodexBar 报错的 provider 会显示菜单栏里那条错误文案，而不是进度条。
