# SQLite 本地存储（v1.7.0）

桌面版使用 Electron 38.8.6 自带 Node.js 22.22.0 的 `node:sqlite`，无额外数据库服务、账号系统或云同步。网页模式仍使用 localStorage。该 Node 版本的 SQLite 接口带实验性提示，本项目固定在已验证的 Electron 版本运行，不使用仅新版 Node 才有的接口。

## 文件位置与初始化

- 数据库：`app.getPath('userData')/users/<账号ID>/coursepilot.db`，默认通常在 Windows 的 `%APPDATA%/coursepilot/`。准确路径可在软件“设置 → 关于”查看。
- 课程课件复制在对应账号目录的 `materials/<课程哈希>/` 下，数据库只保存相对路径。
- 便携 EXE 的临时解压目录、项目源码目录和 release 目录均不存放业务数据库。
- `electron:dev` 热更新开发模式单独使用用户目录的 `development/`，不会把开发测试数据写入正式数据库。普通 `electron` 静态运行与打包版本使用正式数据。
- 第一次启动自动执行 `electron/schema.sql`；无需手工安装 SQLite 或执行 SQL。
- `PRAGMA user_version=2` 为当前结构版本。遇到比当前版本更新的数据库时拒绝打开，避免降级破坏数据。
- 开启外键、WAL 和 `synchronous=FULL`。`coursepilot.db-wal`、`coursepilot.db-shm` 是运行时配套文件；应用运行时不能只复制主文件来制作完整备份，日常使用软件自带的 JSON 导出。

## 表结构

| 表 | 用途 |
| --- | --- |
| courses | 课程 ID、名称、教师、类型、归档状态、配色及备注 |
| sessions | 关联课程的星期、节次、地点和周次；周次对象以 JSON 保存 |
| materials | 课件 ID、课程关联、原文件名、相对存储路径、格式、大小和添加时间 |
| assignments | 作业、课程关联、截止时间、完成状态和提醒记录 |
| settings | 学期、节次数及各节次时间等设置，作为一个 JSON 对象保存 |
| app_meta | 初始化标记、迁移完成标记、数据修订号 |

每次保存将当前完整快照写入一个事务。任一插入、外键或磁盘写入失败时整体回滚。页面只在数据库提交成功后显示新状态和成功提示。针对当前单机、小数据量的应用，这样可以保证覆盖课表和导入备份不会部分成功。数据量明显增长时可进一步改成按记录更新。

## 旧数据迁移

1. 桌面页面把同一用户目录、同一 origin 下原 `coursepilot.data.v1` 交给受限 IPC 接口。
2. 未初始化的数据库会验证旧数据，先写出 `localstorage-before-sqlite-时间戳.json` 原始备份，再事务写入课程、安排、作业、设置及完成标记。
3. 迁移失败会阻止进入业务页面并显示错误，可修正原因后重试。原 localStorage 不删除，也不覆盖。
4. 数据库初始化成功后只读取数据库。再次启动、清空数据或载入备份都不会重新导入旧 localStorage。
5. 浏览器版、不同浏览器、不同 origin 和桌面开发模式的数据不会自动互通；可以用 JSON 导出/导入迁移。

正常更新应继续使用同一个 Windows 用户和应用名 `coursepilot`。不要手工清理用户数据目录。SQLite 是本地存储，删除数据文件、磁盘损坏或重装系统仍可能造成丢失，需要定期备份。

## 访问边界与验证

数据库仅由 Electron 主进程访问；预加载接口仅提供初始化与保存快照，不提供任意 SQL、任意路径或文件读写。主进程校验发送窗口及页面 origin，验证 ID、课程关联、数据大小和节次。页面端串行提交，修订号防止旧快照覆盖新数据。

运行 `npm test` 覆盖实际 SQLite 文件读取、重启、迁移幂等、数据关系、事务失败回滚，以及真实 React 导入页写入失败时不误报成功。模拟故障明确用于验证异常处理，不代表自然发生的 AI 开发失败。

`npm run electron:build` 生成 Windows 便携 EXE。源码、SQL、依赖锁和说明可以提交 Gitee，真实数据库、WAL、SHM 以及旧数据备份不能提交。

如果打包时下载 Electron 遇到网络错误，而本机 `npm install` 已正确安装 Windows Electron，可以先执行 `npm run build`，再运行 `npx electron-builder --win portable --config.electronDist=node_modules/electron/dist`，复用本地运行时。
