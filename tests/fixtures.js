/**
 * 浏览器测试的内存后端：page.route 拦截 /api 请求，不连接 Go、OPC UA 设备或 Kafka。
 * 夹具既提供正常响应，也按 options 模拟冲突、应用回滚、写入超时和回读失败。
 * API 契约变化时需同步这里；它只能证明前端交互，不能替代真实协议集成测试。
 */
/** 构造模拟服务单节点测试数据：用字符串保存节点值，既模拟接口表示，也验证前端不会擅自损失小数精度。 */
export const node = (id, name, type, value) => ({
  id,
  nodeId: `ns=1;i=${id}`,
  name,
  type,
  value,
  dataType: type,
  statusCode: 0,
  quality: 'Good',
  sourceTimestamp: '2026-10-21T01:00:00Z',
  revision: 1,
});
/** 构造采集网关默认测试配置对象，与 GatewayConfiguration 接口契约保持一致。 */
export const configuration = () => ({
  station_code: 'test-station',
  kafka_producer: {
    brokers: '127.0.0.1:9092',
    delivery_timeout: '5s',
    retry_delay: '1s',
    max_retries: 3,
  },
  opc: {
    http_port: 1234,
    http_bind_address: '127.0.0.1',
    allow_insecure_http: true,
    allow_insecure_opcua: true,
    reconnect_interval: '5s',
    publishing_interval: '250ms',
    sampling_interval: '100ms',
    queue_size: 32,
    drain_timeout: '2s',
    shutdown_timeout: '5s',
    aggregation_window: '1s',
    operation_timeout: '10s',
    local_buffer_size: 1024,
    send_queue_size: 16,
    max_nodes: 200000,
    security: {
      policy: 'none',
      mode: 'none',
      certificate_file: '',
      private_key_file: '',
      trust_list_files: [],
      revocation_list_files: [],
    },
    machines: [
      {
        code: 'machine-1',
        server: 'opc.tcp://127.0.0.1:4840',
        topic: 'test-topic',
      },
    ],
  },
});
/**
 * 注册页面级 API 路由拦截器（拦截所有 /api/ 请求），返回可变内存状态对象 state。
 * options 支持注入 nodeConflict、configConflict、rollback、readOnly、writeFailure、readbackDelay、readbackFailure 等异常场景。
 */
export async function mockAPIs(page, options = {}) {
  // 每次调用创建独立 state；用例可检查 writes/saves 等计数，证明没有重复发送操作。
  // Arrange（准备）：建立可变内存模型。Act（操作）由用例点击真实界面触发，
  // Assert（断言）既检查可见 UI，也读取 state 计数，确认没有额外写入/保存等副作用。
  const state = {
    nodes: [
      node(1, '出口温度', 'FLOAT', '42.125'),
      node(2, '转速', 'LONG', '1234'),
      node(3, '开关', 'Bit', 'true'),
      // 故意放入类似 HTML 的名称，验证 JSX 当文本显示而不是执行脚本。
      node(4, '<script>window.injected=true</script>', 'BYTE', '7'),
    ],
    config: configuration(),
    revision: 'revision-1',
    inSync: true,
    writes: [],
    saves: [],
    mutations: [],
    readOnly: !!options.readOnly,
    reloads: 0,
    history: [],
    values: {},
    generation: 1,
    catalogTotal: 30,
    cachedReads: 0,
    directReads: 0,
    valueReads: 0,
  };
  state.logs = Object.fromEntries(
    // 两个服务各有一份不断可变的日志集合和独立进程 ID，供翻页/重启测试控制。
    ['server', 'gateway'].map((service) => [
      service,
      Array.from({ length: 125 }, (_, index) => ({
        id: index + 1,
        time: new Date(Date.now() - (125 - index) * 1000).toISOString(),
        level: ['INFO', 'WARN', 'ERROR', 'DEBUG'][index % 4],
        message: `${service} log ${index + 1} ${index % 4 === 1 ? '连接重试' : '运行记录'}`,
        component: ['http', 'opc', 'kafka'][index % 3],
        machine: service === 'gateway' ? `machine-${(index % 2) + 1}` : '',
        requestId: `request-${service}-${index + 1}`,
        fields: {
          component: ['http', 'opc', 'kafka'][index % 3],
          operation: `operation-${index + 1}`,
          authorization: '[REDACTED]',
        },
      })),
    ]),
  );
  state.logInstances = {
    server: 'server-instance-1',
    gateway: 'gateway-instance-1',
  };
  state.logRequests = [];
  state.runningConfig = structuredClone(state.config);
  state.simulation = {
    revision: 1,
    persistent: true,
    running: true,
    rules: [],
    config: {
      enabled: true,
      tickMs: 100,
      nodes: state.nodes.map((n) => ({
        id: n.id,
        enabled: false,
        baseline: n.type === 'Bit' ? 1 : 10,
        min: 0,
        max: n.type === 'Bit' ? 1 : 100,
        amplitude: 0,
        intervalMs: 1000,
      })),
      rules: [],
    },
  };
  const view = () => ({
    // 文件视图需要深复制；前端修改自己的草稿不能反向污染测试后端的原始配置。
    config: structuredClone(state.config),
    revision: state.revision,
    file: 'gateway.toml',
    canSave: true,
    inSync: state.inSync,
  });
  await page.route('**/api/**', async (route) => {
    // 读取请求方法、路径与 JSON body，然后在后续分支中模拟对应 HTTP 处理器。
    const req = route.request(),
      url = new URL(req.url()),
      method = req.method(),
      path = url.pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let body;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    const send = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    const logService =
      path === '/api/server/logs'
        ? 'server'
        : path === '/api/gateway/logs'
          ? 'gateway'
          : '';
    if (logService) {
      // 日志筛选先固定 anchor，再过滤并倒序分页，模拟新增日志不移动旧页的约定。
      if (req.headers().authorization)
        return send({ error: 'unexpected authorization header' }, 400);
      const filters = Object.fromEntries(url.searchParams);
      state.logRequests.push({ service: logService, ...filters });
      const retained = state.logs[logService];
      const latestId = retained.at(-1)?.id || 0;
      const anchor = Math.min(Number(filters.anchor) || latestId, latestId);
      const offset = Number(filters.offset) || 0,
        limit = Number(filters.limit) || 50;
      const entries = retained
        .filter(
          (entry) =>
            entry.id <= anchor &&
            (!filters.level || entry.level === filters.level) &&
            (!filters.component || entry.component === filters.component) &&
            (!filters.machine || entry.machine === filters.machine) &&
            (!filters.from ||
              Date.parse(entry.time) >= Date.parse(filters.from)) &&
            (!filters.to || Date.parse(entry.time) <= Date.parse(filters.to)) &&
            (!filters.q ||
              JSON.stringify(entry)
                .toLowerCase()
                .includes(filters.q.toLowerCase())),
        )
        .toReversed();
      const page = {
        entries: entries.slice(offset, offset + limit),
        total: entries.length,
        offset,
        limit,
        anchor,
        latestId,
        oldestId: retained[0]?.id || 0,
        instanceId: state.logInstances[logService],
        capturedAt: new Date().toISOString(),
        startedAt: new Date(Date.now() - 60000).toISOString(),
        retained: retained.length,
        capacity: 3000,
        bytes: retained.length * 300,
        byteBudget: 8388608,
        discarded: 0,
        components: [...new Set(retained.map((entry) => entry.component))],
        machines: [
          ...new Set(retained.map((entry) => entry.machine).filter(Boolean)),
        ],
        levels: Object.fromEntries(
          ['DEBUG', 'INFO', 'WARN', 'ERROR'].map((level) => [
            level,
            retained.filter((entry) => entry.level === level).length,
          ]),
        ),
        source: 'memory',
      };
      return send(
        logService === 'gateway'
          ? { code: 200, message: 'ok', data: page }
          : page,
      );
    }
    if (path.startsWith('/api/server')) {
      // 模拟服务直接返回 JSON 对象；后面的网关分支则使用 {code, message, data}。
      if (path === '/api/server/health')
        return send({
          state: 'running',
          nodeCount: state.nodes.length,
          persistent: true,
          simulationRunning: true,
        });
      if (path === '/api/server/simulation/status')
        return send({
          revision: state.simulation.revision,
          running: true,
          rules: state.simulation.rules,
          capturedAt: new Date().toISOString(),
        });
      if (path === '/api/server/simulation/validate')
        return send({ valid: true });
      if (path === '/api/server/nodes' && method === 'GET')
        return send({
          endpoint: 'opc.tcp://127.0.0.1:4840',
          state: 'running',
          startedAt: '2026-10-21T00:00:00Z',
          capturedAt: new Date().toISOString(),
          persistent: true,
          nodes: state.nodes,
        });
      if (path === '/api/server/nodes' && method === 'POST') {
        const next = node(body.id, body.name, body.type, body.value);
        state.nodes.push(next);
        state.mutations.push(body);
        return send(next, 201);
      }
      if (/\/nodes\/\d+$/.test(path)) {
        const id = Number(path.split('/').at(-1)),
          n = state.nodes.find((n) => n.id === id);
        if (!n) return send({ error: '节点不存在' }, 404);
        if (method === 'GET') return send(n);
        if (options.nodeConflict) return send({ error: '节点版本冲突' }, 409);
        if (method === 'PATCH') {
          state.mutations.push(body);
          Object.assign(n, body, { revision: n.revision + 1 });
          return send(n);
        }
        if (method === 'DELETE') {
          state.nodes = state.nodes.filter((n) => n.id !== id);
          return route.fulfill({ status: 204 });
        }
      }
      if (path === '/api/server/simulation') {
        if (method === 'PUT') {
          state.simulation.config = body.config;
          state.simulation.revision++;
          state.mutations.push(body);
        }
        return send(state.simulation);
      }
      return send({ error: '未知接口' }, 404);
    }
    if (req.headers().authorization)
      return send(
        { code: 400, message: 'unexpected authorization header' },
        400,
      );
    const success = (data) => send({ code: 200, message: 'ok', data });
    if (path === '/api/gateway/capabilities')
      return success({
        apiVersion: '1',
        directReadback: true,
        rediscover: true,
        configurationHistory: true,
        monitorSources: ['cache', 'device'],
      });
    if (path === '/api/gateway/config/current')
      return success(state.runningConfig);
    if (path === '/api/gateway/config/history')
      return success(
        state.history.map(({ id, createdAt, stationCode }) => ({
          id,
          createdAt,
          stationCode,
        })),
      );
    if (path.startsWith('/api/gateway/config/history/')) {
      const entry = state.history.find(
        (item) => item.id === path.split('/').at(-1),
      );
      return entry
        ? success(entry)
        : send({ code: 404, message: 'not found' }, 404);
    }
    if (path === '/api/gateway/config') {
      // 文件、草稿、运行态在这里也区分；apply=false 只变文件，不变 runningConfig。
      if (method === 'PUT') {
        state.saves.push(body);
        // 用 options 可重复地制造错误，不依赖网络偶发失败；409 不更新已存配置。
        if (options.configConflict)
          return send({ code: 409, message: 'configuration conflict' }, 409);
        // 应用失败与“仅保存”区分：模拟返回 fileRestored，让 UI 说明回滚并保留草稿。
        if (options.rollback && body.apply)
          return send(
            {
              code: 504,
              message: 'unconfirmed delivery',
              data: { fileRestored: true, reason: 'unconfirmed_delivery' },
            },
            504,
          );
        state.history.unshift({
          id: `version-${state.history.length + 1}`,
          createdAt: new Date().toISOString(),
          stationCode: state.config.station_code,
          config: structuredClone(state.config),
        });
        if (body.apply) state.runningConfig = structuredClone(body.config);
        state.config = body.config;
        state.revision += 'x';
        state.inSync = body.apply;
        return success({
          configuration: view(),
          applied: body.apply,
          plan: {},
        });
      }
      return success(view());
    }
    if (path === '/api/gateway/status')
      return success({
        stationCode: state.config.station_code,
        kafkaBrokers: state.config.kafka_producer.brokers,
        readOnly: state.readOnly,
        serverTime: new Date().toISOString(),
        machines: [
          {
            code: 'machine-1',
            server: 'opc.tcp://127.0.0.1:4840',
            topic: 'test-topic',
            connected: true,
            ready: true,
            nodeCount: state.catalogTotal,
            generation: state.generation,
            sessionEpoch: state.generation,
            lastBrowseTime: new Date().toISOString(),
            lastAckTime: new Date().toISOString(),
          },
        ],
        kafka: {
          successfulBatches: 10,
          failedBatches: 0,
          queuedMessages: 0,
          unknownBatches: 0,
        },
        kafkaConnection: {
          state: 'connected',
          latencyMs: 1,
          checkedAt: new Date().toISOString(),
        },
      });
    if (path === '/api/gateway/nodes/rediscover') {
      state.generation++;
      state.catalogTotal++;
      return success({ generation: state.generation, code: body.machine });
    }
    if (path === '/api/gateway/nodes/value') {
      // 单点回读可设置延迟/失败，验证写入已接受后界面仍需等待实际读回。
      state.valueReads++;
      if (options.readbackDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, options.readbackDelay),
        );
      if (options.readbackFailure)
        return send({ code: 503, message: 'read failed' }, 503);
      const code = url.searchParams.get('code');
      return success({
        code,
        name: '设备节点 ' + code.split(':')[1],
        type: 'number',
        value: state.values[code] ?? String(Number(code.split(':')[1]) - 1),
        quality: 0,
        observedAt: new Date().toISOString(),
        sourceTime: new Date().toISOString(),
        stale: false,
      });
    }
    if (path === '/api/gateway/nodes') {
      // 分别记录缓存查询和设备直读；测试据此确认自动监控不会反复直读设备。
      if (url.searchParams.get('source') === 'cache') state.cachedReads++;
      else state.directReads++;
      const offset = Number(url.searchParams.get('offset')),
        search = url.searchParams.get('search');
      let nodes = Array.from({ length: state.catalogTotal }, (_, i) => ({
        code: `1:${i + 1}`,
        name: `设备节点 ${i + 1}`,
        type: 'number',
        value: state.values[`1:${i + 1}`] ?? String(i),
        observedAt: new Date().toISOString(),
        stale: false,
        quality: 0,
        sourceTime: new Date().toISOString(),
      }));
      if (search) nodes = nodes.filter((n) => n.name.includes(search));
      return success({
        nodes: nodes.slice(offset, offset + 25),
        total: nodes.length,
        offset,
        limit: 25,
        readAt: new Date().toISOString(),
        capturedAt: new Date().toISOString(),
        cached: url.searchParams.get('source') === 'cache',
        connected: true,
        stale: false,
        catalogRevision: String(state.generation),
        catalogAt: new Date().toISOString(),
      });
    }
    if (path === '/api/gateway/nodes/write') {
      // 即使响应失败也记录一次写请求，用来断言 UI 没有在结果未知时自动重写。
      state.writes.push(body);
      // 先记入 writes 再返回失败，模拟“请求已发出但结果未知”，不能据此认为未执行过。
      if (options.writeFailure)
        return send({ code: 504, message: 'device timeout' }, 504);
      state.values[body.code] = body.value;
      return success({ operationId: 'test-write-id', state: 'accepted' });
    }
    if (path === '/api/gateway/config/validate')
      return success({
        kafkaChanged: true,
        addedMachines: [],
        removedMachines: [],
        restartedMachines: [],
      });
    if (path === '/api/gateway/config/reload') {
      state.reloads++;
      state.inSync = true;
      state.runningConfig = structuredClone(state.config);
      return success({});
    }
    // 不认识的接口明确失败，防止前端误拼路径时夹具仍返回看似成功的通用响应。
    return send({ code: 404, message: '未知接口' }, 404);
  });
  return state;
}
/** 打开采集网关指定子页面（默认 overview），通过真实 Hash 路由进入对应视图。 */
export async function openGateway(page, path = 'overview') {
  // 通过真实 Hash 地址进入页面，走与用户导航相同的 React 路由路径。
  await page.goto('/#gateway/' + path);
}

/** 跨视口导航辅助函数：自动适配桌面固定侧栏与移动端抽屉菜单，按可访问名称点击目标链接。 */
export async function navigateTo(page, title, group) {
  // 统一处理桌面侧栏和移动抽屉；按语义角色/可访问名称定位，减少对 CSS 结构的依赖。
  const toggle = page.getByRole('button', { name: '展开导航', exact: true });
  const mobile = await toggle.isVisible();
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute('aria-expanded')) !== 'true'
  )
    await toggle.click();
  const navigation = page.getByRole('navigation', { name: '主导航' });
  const scope = group
    ? navigation.getByRole('region', { name: group, exact: true })
    : navigation;
  await scope.getByRole('link', { name: title, exact: true }).click();
  if (mobile)
    await page
      .getByRole('navigation', { name: '主导航' })
      .waitFor({ state: 'hidden' });
}
