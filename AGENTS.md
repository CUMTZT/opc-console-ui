# AGENTS.md — OPC Studio · Console (`opc-console-ui`)

本工程是 **OPC Studio（工业仿真与数采工作台）** 的独立前端控制台，基于 React 19 + Vite 8 构建，统一管理 `opc-server-go`（模拟服务）与 `opc-gateway-go`（采集网关）。

---

## 1. 目录与模块结构

- `src/App.jsx`：工作空间外壳、左侧分组导航（系统总览 / 模拟服务 / 采集网关）、移动端抽屉焦点管理与 Hash 路由分发（兼容 `#server` 旧书签直达 `#server/monitor`）。
- `src/Server.jsx` & `src/Simulation.jsx`：模拟服务子页面、节点 CRUD、CSV 导出、动态波动参数与有序业务规则编排器。
- `src/Gateway.jsx` & `src/Configuration.jsx`：采集网关自动连接、状态监控、节点读写与连接/网关配置表单。
- `src/features/`：
  - `overview/`：系统总览（模拟服务 → OPC UA 连接 → 采集就绪 → Kafka 投递全链路状态与快捷入口）。
  - `server-overview/`：模拟服务运行总览、数据质量与节点类型分布。
  - `gateway-nodes/`：按机组分页浏览订阅缓存、立即读取设备、单节点安全写入与重新发现节点。
  - `gateway-config/`：文件/草稿/运行态三方配置差异对比与最近 20 个脱敏历史版本载入。
  - `gateway-status/`：网关诊断与协议探测状态。
  - `logs/`：模拟服务与采集网关共用的运行日志查询、筛选、自动刷新与详情抽屉。
- `src/api/`：统一请求封装、错误处理与 TypeScript 接口契约（`contracts.ts`）。
- `scripts/start-local.mjs`：跨工程本地预检（`--check`）与三工程联合启动脚本。
- `deploy/nginx.conf`：生产环境静态资源托管与同源反向代理示例配置。
- `tests/`：基于 Playwright 的全量浏览器交互回归测试与 `fixtures.js` 内存 API 模型。

---

## 2. 常用命令

> 需要 **Node.js >= 22.12**。

```sh
# 1. 本地开发（默认 http://127.0.0.1:5173/）
npm run dev

# 2. 类型契约检查、代码格式检查与生产构建（提交前必跑）
npm run typecheck
npm run format:check
npm run build

# 3. 运行 Playwright 浏览器测试（使用独立 15174 端口与内存 Mock，不连外部服务）
npm test

# 4. 跨工程本地环境预检与三工程联合启动
npm run check:local
npm run start:local

# 5. 对接真实运行的 Go 后端执行端到端验收
LIVE_APIS=1 UI_TEST_URL=http://127.0.0.1:4173 npm test -- tests/live.spec.js
```

---

## 3. 前端状态、网络与交互红线

1. **同源代理与免令牌请求**：
   - 浏览器代码只允许请求同源 `/api/server/*` 与 `/api/gateway/*`，不得将后端 IP/端口打包进前端产物，也不发送 `Authorization` 请求头。
   - Vite 代理配置（`vite.config.js`）通过环境变量 `SERVER_API_TARGET` 与 `GATEWAY_API_TARGET` 控制上游地址，并保留原始 `Host`、`Origin` 与 `Sec-Fetch-Site`。
2. **串行轮询与请求取消保护**：
   - 所有定时轮询必须在**上一次请求完成后**再安排下一次定时器，严禁使用固定 `setInterval` 造成慢网下请求堆积。
   - 当浏览器标签页不可见（`document.hidden`）或当前未处于对应服务页面时，必须暂停非必要的轮询（系统总览仅按需观察网关摘要）。
   - 切换查询条件、分页或离开页面时必须通过 `AbortController` 取消在途请求，防止旧响应乱序覆盖最新状态。
3. **草稿保护、乐观锁冲突（`409`）与回滚展示**：
   - 在前端内部切换哈希路由时，必须保留用户尚未保存的模拟配置草稿；当存在未保存修改时，需注册 `beforeunload` 提醒。
   - 模拟方案实时运行进度与最近 128 条内存调试轨迹需独立刷新，不得覆盖正在编辑的草稿。
   - 节点或配置保存返回 `409 Conflict` 时，必须保留当前草稿并提示冲突；网关配置热应用失败时，需清晰展示后端的自动回滚结果，并允许用户随后选择“仅保存”。
4. **设备安全写入与缓存陈旧度提示**：
   - 网关节点自动监控默认读取订阅缓存（展示缓存生成时间、目录版本与最近观测时间），而“立即读取设备”单独触发协议读取。
   - 当暂停刷新较久或连接异常导致数据陈旧，或后端处于 `--read-only` 模式时，必须限制写入操作并引导用户先重新读取。
   - 单节点写入完成后保持弹窗直至回读确认；若写入结果未知（`unknown`），**严禁提供直接重试按钮或自动重写**，只能引导用户关闭窗口并重新读取设备值。
5. **可访问性（A11y）与响应式布局**：
   - 桌面端采用深色分组侧栏 + 浅色工作区；移动端（`<= 900px`）使用抽屉导航，必须保持焦点环绕（Focus Trap）、支持 `Escape` 关闭并恢复触发按钮焦点，且任何视口下不得出现水平滚动条溢出（`scrollWidth <= innerWidth`）。
   - 新增或修改表单控件、表格区域、状态提示时，务必提供明确的 `aria-label`、`<label>` 或语义化 `role`，并与 `tests/*.spec.js` 及 `tests/fixtures.js` 保持同步。
