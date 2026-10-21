# OPC Console UI

独立的 React 19 + Vite 8 管理控制台，统一管理 `opc-server-go` 模拟服务和 `opc-gateway-go` 采集网关。两个 Go 服务仅提供 API，不再包含 HTML、CSS、JavaScript 或前端构建依赖。

## 1.1.0 更新与联合启动

本轮修复与测试见 [1.1.0 验证记录](docs/verification-1.1.0.md)。前端需要配套的 1.1.0 Go 服务：请重启旧后端使缓存、重新发现和回读等 API 生效。

三个工程位于同一父目录且已有对应平台二进制时，可以从父目录启动：

```sh
npm --prefix ./opc-console-ui run check:local
npm --prefix ./opc-console-ui run start:local
```

联合脚本检查 CSV、TOML、二进制和端口，然后启动两个 Go 服务与 Vite；Ctrl+C 统一停止。默认读取网关 `config/config.toml`，缺少时读取 `config/config.example.toml`，保留文件原有的 OPC UA / Kafka 地址。脚本不会启动 Kafka，也不会终止占用端口的已有进程。

可用环境变量 `GATEWAY_CONFIG`、`OPC_SERVER_DATA`、`OPC_SERVER_PORT`、`OPC_SERVER_HTTP_PORT`、`OPC_UI_PORT` 覆盖路径与端口。改变 OPC UA 端口后，还需手动同步网关机组 Endpoint；脚本不重写 TOML。`OPC_SERVER_BINARY` / `OPC_GATEWAY_BINARY` 可以指定二进制，较长退出预算可用 `LOCAL_STOP_TIMEOUT_MS` 调整。Windows 需具备对应 EXE，当前运行验收在 Linux / WSL 上完成。

## 开发运行

需要 Node.js 22.12+（本次使用 Node.js 26 验证）。在本工程目录中：

```sh
npm ci
npm run dev
```

打开 **http://127.0.0.1:5173/**。Go 服务分别启动，默认管理接口为：

| 服务           | 默认地址                | 用途                         |
| -------------- | ----------------------- | ---------------------------- |
| opc-server-go  | `http://127.0.0.1:8080` | 节点管理、模拟配置           |
| opc-gateway-go | `http://127.0.0.1:1234` | 运行状态、配置管理、设备读写 |

模拟服务启动示例（在 `opc-server-go` 目录）：

```sh
go run ./cmd/opc-server-go --hostname localhost --objects
```

网关启动（在 `opc-gateway-go` 目录，使用你实际维护的配置路径）：

```sh
go run ./cmd/opc-gateway --config config/config.toml
```

网关配置中的 OPC UA Endpoint、Kafka Broker 必须是网关机器能够访问的地址。配置与服务启动仍由各 Go 工程管理。关闭 UI 不会停止两个后端服务；仅查看模拟服务时无需启动网关。

若监听地址不同，复制 `.env.example` 为 `.env.local` 后修改并重启 Vite：

```dotenv
SERVER_API_TARGET=http://127.0.0.1:8080
GATEWAY_API_TARGET=http://127.0.0.1:1234
```

这些变量只配置 Vite 代理，不进入浏览器构建产物。网关页面自动连接后端，无需登录或管理令牌；系统总览会自动获取网关状态。

## 页面功能

- 系统总览（默认首页）：模拟服务、OPC UA 连接、采集就绪和 Kafka 状态。
- 模拟服务 / 总览：服务运行信息、数据质量、节点类型分布，以及配置和监控入口。
- 模拟服务 / 配置：节点基准值、上下限、波动幅度与周期；按顺序写入的业务规则、条件比较、延迟和渐变输出；方案校验、JSON 导入导出与运行轨迹。切换页面保留未保存草稿，刷新或关闭浏览器前提示未保存修改。
- 模拟服务 / 数据监控：搜索、类型与质量筛选、排序、自动/手动刷新、变化高亮、详情、复制、CSV 导出、节点增删改查。
- 网关总览：运行中的机组、Kafka 实际协议探测、投递计数和当前会话趋势。
- 设备节点：按运行中的机组分页读取、搜索、暂停刷新、单节点写入；遵守后端只读模式。写入结果未知时禁止直接重试，需要关闭窗口并重新读取。
- 连接配置与网关设置：Kafka/OPC UA 连接、采集参数、队列与超时、安全策略和证书路径。保留配置校验、仅保存、保存并应用、重新读取、重载文件之间的区别。

节点与配置更新携带后端 revision；409 冲突保留草稿。配置热应用失败时展示后端回滚结果，并允许随后选择仅保存。配置文件和节点状态文件的持久化仍由 Go 服务负责。

轮询在隐藏页面和未选中的服务模块暂停。同一轮询完成后再安排下一次请求；切换查询或关闭页面会取消旧请求，避免旧响应覆盖新状态。浏览器刷新后自动重新连接网关；连接失败会显示错误并自动重试。

节点自动监控读取订阅缓存，显示缓存生成时间、目录版本及最近观测时间；“立即读取设备”单独执行协议读取。缓存不会根据不变化的源时间误判离线。暂停查询较久或连接异常时会标记旧数据并限制写入，用户可先重新读取。

“重新发现节点”会等待旧消息确认并重建该机组会话；目录更新后还需等待新快照确认。写入完成后保持弹窗直到回读，未知结果只允许重新读取，不自动重复写入。页面操作记录仅保存在当前会话中。

配置页面展示文件、草稿和运行配置的差异，支持载入最近 20 个脱敏历史版本为草稿。模拟方案支持校验导入，按现有节点 ID 严格匹配；实时进度和最近 128 条内存调试轨迹独立刷新，不覆盖草稿。

左侧导航按“系统总览”“模拟服务”“采集网关”分组。模拟服务的直达地址为 `/#server/overview`、`/#server/configuration`、`/#server/monitor`；原来的 `/#server` 链接仍打开数据监控。网关保留运行总览、节点监控、连接配置和网关设置四个页面。

## 构建与部署

```sh
npm run build
```

输出 `dist/`，可独立托管，无需在运行环境安装 Node.js。前端资源更新无需重新编译或重启 Go 服务。首次升级到免令牌版本时，需要重新构建并重启采集网关，以移除旧程序的令牌校验。

本机预览构建产物（仍使用上述环境变量代理后端）：

```sh
npm run preview
```

打开 **http://127.0.0.1:4173/**。生产部署可使用 `deploy/nginx.conf`：将 `root` 改为实际 `dist` 路径，修改两个上游地址，然后加载 Nginx 配置；示例入口为 `http://localhost:8088/`。Vite preview 用于构建验收，生产使用静态 Web 服务。

浏览器始终访问同源接口，代理规则为：

| 浏览器请求                   | 转发到后端                 |
| ---------------------------- | -------------------------- |
| `/api/server/nodes`          | 模拟服务 `/api/nodes`      |
| `/api/server/simulation`     | 模拟服务 `/api/simulation` |
| `/api/gateway/status`        | 网关 `/api/status`         |
| `/api/gateway/config`        | 网关 `/api/config`         |
| `/api/gateway/config/reload` | 网关 `/api/config/reload`  |
| `/api/gateway/nodes`         | 网关 `/api/nodes`          |

代理保留浏览器 Host，不修改 Origin 与 Sec-Fetch-Site，沿用模拟服务的跨域写入保护。前端不发送 Authorization 请求头，无需放开通配 CORS。两个后端可以部署在不同机器，但浏览器访问入口相同。

模拟服务与采集网关的 HTTP 管理接口均无需令牌，默认仅监听本机。网关旧配置中的 `http_auth_token` 和 `allow_insecure_http` 字段仅为兼容保留，不再参与认证或启动校验。代理与 Go 服务分布在不同机器时，相应调整后端监听地址和网络访问范围。

## 验证

```sh
npm ci
npx playwright install chromium
npm test
npm run build
```

浏览器测试使用独立 15174 端口，避免复用用户正在运行的 5173 页面。浏览器测试使用内存 API 模型验证交互、冲突、回滚、只读、自动连接及故障恢复与未知写入结果，不连接现场设备或 Kafka。Go 工程中的协议和 API 回归测试独立运行。

真实本机 API 验收需显式启动隔离的两个 Go 服务及 Vite/preview，然后运行：

```sh
# UI_TEST_URL 指向已经启动且配置了代理的前端
LIVE_APIS=1 UI_TEST_URL=http://127.0.0.1:4173 npm test -- tests/live.spec.js
```

真实验收会创建并删除一个专用临时节点，无需管理令牌。请使用临时节点状态文件与网关测试配置。

本次实际检查范围与结果见 [验证记录](docs/verification.md)。

## 目录

```text
src/App.jsx             工作空间与服务导航
src/Server.jsx          模拟服务子页面、共享节点状态和 CRUD
src/Simulation.jsx      动态模拟与规则编辑器
src/Gateway.jsx         自动连接、状态、设备读写、配置操作
src/Configuration.jsx   网关配置表单
src/shared.jsx          轮询、弹窗与通用展示
src/api/                请求、错误与 TypeScript 接口契约
src/features/           节点状态、配置差异、诊断与系统概览
scripts/start-local.mjs  三工程联合启动与预检
deploy/nginx.conf       独立静态托管与 API 代理示例
tests/                  浏览器交互与可选真实 API 验收
```
