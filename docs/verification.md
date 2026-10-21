# 前后端分离验证记录

日期：2026-10-21。环境：Linux / WSL、Go 1.27.2、Node.js 26.7.0、React 19.3.1、Vite 8.3.4。

## 结果

| 检查                                                                                  | 结果                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 两个 Go 工程 `go test ./...`                                                          | 全部通过；未配置外部设备 / Kafka 的专用集成测试按原有规则跳过 |
| 两个 Go 工程 `go vet ./...`                                                           | 通过                                                          |
| server：`go test -race ./internal/webmonitor ./internal/opcserver`                    | 通过，包含真实 OPC UA 协议与 HTTP 管理回归                    |
| gateway：`go test -race ./internal/httpapi`                                           | 通过                                                          |
| React：`npm test`                                                                     | 9 项浏览器交互测试通过；需显式启用的真实 API 用例默认跳过     |
| React：`LIVE_APIS=1 UI_TEST_URL=http://127.0.0.1:4173 npm test -- tests/live.spec.js` | 独立运行通过                                                  |
| React：`npm run format:check`                                                         | 通过                                                          |
| React：`npm run build`                                                                | 通过，生成独立 `dist/`，无后端或 Node.js 运行时依赖           |
| 两个 Go 服务 Linux amd64 / Windows amd64 构建                                         | 均通过；Windows 为交叉编译，未做 Windows 浏览器运行验证       |
| 旧内嵌页面与静态资源                                                                  | 已移除；真实服务根路径、网关旧静态资源在有效鉴权后均返回 404  |

## 浏览器测试范围

交互用例覆盖节点搜索、CSV 导出、四种类型展示、字符串精度、名称转义、创建 / 编辑 / 删除、保留最新值的编辑方式、节点 revision 冲突保留草稿、模拟参数与顺序规则保存、网关登录、节点分页、设备只读、未知写入结果禁止直接重试、令牌过期清理、仅保存与重载的区别、热应用回滚提示与草稿保留、390px 移动端布局。

真实联调使用独立的临时状态文件与网关配置，Go HTTP 端口为 18880 / 11234，OPC UA 端口为 14840，Vite preview 入口为 4173。浏览器通过实际代理完成节点创建、修改、删除、模拟配置读取，以及网关鉴权和配置校验；未放宽跨域写入保护。浏览器无脚本异常。

网关使用隔离的本机 Broker 地址，此轮 UI 联调没有运行 Kafka 消息投递验收，也未连接现场设备或配置示例中的远程 Broker。生产 Nginx 配置提供为部署示例，本轮实际验证的代理为 Vite dev / preview。

真实联调结束后确认节点恢复为原有 345 个，临时测试节点已删除，隔离服务和前端预览进程均已停止。现有服务配置、CSV 和节点状态未被测试改写。

## 迁移后的发布位置

- 前端构建产物：`opc-console-ui/dist/`，单独托管。
- 服务端：`opc-server-go/dist/linux-amd64/opc-server-go`、`opc-server-go/dist/windows-amd64/opc-server-go.exe`。
- 网关：`opc-gateway-go/build/go/opc-gateway`、`opc-gateway-go/build/go/opc-gateway.exe`。

两个 Go 工程不再包含前端源码或嵌入资源，也不需要 Node.js 完成 Go 构建。
