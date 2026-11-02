# @uiyzzi/paseo-chat-sessions

给 Paseo 加一个当草稿纸用的 «聊天» 项目：在新建会话界面选中它，插件就在配置的根目录下建一个新的子目录，会话在那个目录里跑。适合临时提问、试提示词、写一次性脚本，不落到真正的仓库里。

## 装

```bash
paseo plugin install ./packages/chat-sessions
```

改完源码后：

```bash
npm run typecheck -w packages/chat-sessions
paseo plugin reload paseo-chat-sessions
```

## 行为

- 根目录默认 `~/.PaseoChats`，自动注册成 Paseo 项目并改名为 «聊天»。
- 每次从这个项目新建会话，都会创建 `chat-<年月日>-<时分秒>-<随机>` 子目录，并把它作为 workspace 的 cwd。
- 会话目录是普通空目录，不是 git 仓库。
- 一周前创建且仍然为空的会话目录会被清理（可在设置里关掉）。
- 设置 → 插件 → 聊天会话 里可以改根目录、项目名、清理开关，也能手动补注册项目、按 App 语言重置项目名。
- 界面文案有 en / zh-CN 两套（`client/locales/`），跟随 App 语言；项目名是 daemon 数据，不跟随。

实现方式是 `workspace.create.before` 钩子（0.14 daemon 用等价的 `before("workspace.create")`）：只改写指向聊天根目录的 `directory` 请求，其他请求原样放行。
