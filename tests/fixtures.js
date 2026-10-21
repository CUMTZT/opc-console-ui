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
export async function mockAPIs(page, options = {}) {
  const state = {
    nodes: [
      node(1, '出口温度', 'FLOAT', '42.125'),
      node(2, '转速', 'LONG', '1234'),
      node(3, '开关', 'Bit', 'true'),
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
    config: structuredClone(state.config),
    revision: state.revision,
    file: 'gateway.toml',
    canSave: true,
    inSync: state.inSync,
  });
  await page.route('**/api/**', async (route) => {
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
    if (path.startsWith('/api/server')) {
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
      if (method === 'PUT') {
        state.saves.push(body);
        if (options.configConflict)
          return send({ code: 409, message: 'configuration conflict' }, 409);
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
      state.writes.push(body);
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
    return send({ code: 404, message: '未知接口' }, 404);
  });
  return state;
}
export async function openGateway(page, path = 'overview') {
  await page.goto('/#gateway/' + path);
}
