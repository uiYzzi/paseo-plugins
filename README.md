# paseo-packages

我的 Paseo 插件合集。每个包一个目录，装到 Paseo 就能用。

## 现有的包

| 包 | 干什么 |
|---|---|
| [chat-sessions](./packages/chat-sessions/) | 项目选择器里多一个 «聊天»，每次新建会话都开一个新的临时目录 |

## 装

```bash
paseo plugin install ./packages/chat-sessions
```

`paseo plugin install` 接受目录、Git 或 npm 源；装完用 `paseo plugin reload <id>` 让源码改动生效。

## 目录约定

```
paseo-packages/
  package.json        npm workspace 根
  packages/
    <package>/
      README.md
      OVERVIEW.md       Paseo 插件页文案
      paseo-plugin.json 插件清单（id 与 requirements.paseo）
      index.client.tsx  客户端入口
      index.server.ts   daemon 入口
      client/ server/ shared/
      package.json
      tsconfig.json
```

`requirements.paseo` 要按**最低可用客户端版本**写：daemon 是 0.15 但 App 是 0.14 时，写成 `>=0.15.0` 会让整个插件在 App 里加载失败。
