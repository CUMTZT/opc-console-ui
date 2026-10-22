export interface MonitoredNode {
  code: string;
  name: string;
  type: string;
  value: string;
  quality: number;
  sourceTime: string;
  observedAt?: string;
  stale?: boolean;
}
export interface NodePage {
  nodes: MonitoredNode[];
  total: number;
  offset: number;
  limit: number;
  readAt: string;
  capturedAt?: string;
  cached?: boolean;
  connected?: boolean;
  stale?: boolean;
  catalogRevision?: string;
  catalogAt?: string;
}
export interface SimulationProfile {
  id: number;
  enabled: boolean;
  baseline: number;
  min: number;
  max: number;
  amplitude: number;
  intervalMs: number;
}
export interface SimulationStep {
  nodeId: number;
  operator: string;
  value: string;
}
export interface SimulationOutput {
  nodeId: number;
  target: number;
  delayMs: number;
  durationMs: number;
}
export interface SimulationRule {
  id: string;
  name: string;
  enabled: boolean;
  windowMs: number;
  steps: SimulationStep[];
  outputs: SimulationOutput[];
}
export interface SimulationConfig {
  enabled: boolean;
  tickMs: number;
  nodes: SimulationProfile[];
  rules: SimulationRule[];
}
export interface GatewayConfiguration {
  station_code: string;
  kafka_producer: {
    brokers: string;
    delivery_timeout: string;
    retry_delay: string;
    max_retries: number;
  };
  opc: {
    http_port: number;
    http_bind_address: string;
    allow_insecure_http: boolean;
    allow_insecure_opcua: boolean;
    reconnect_interval: string;
    publishing_interval: string;
    sampling_interval: string;
    queue_size: number;
    drain_timeout: string;
    shutdown_timeout: string;
    aggregation_window: string;
    operation_timeout: string;
    local_buffer_size: number;
    send_queue_size: number;
    max_nodes: number;
    security: {
      policy: string;
      mode: string;
      certificate_file: string;
      private_key_file: string;
      trust_list_files: string[];
      revocation_list_files: string[];
    };
    machines: { code: string; server: string; topic: string }[];
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function requireType(
  value: unknown,
  type: 'string' | 'boolean' | 'number',
  path: string,
): void {
  if (typeof value !== type || (type === 'number' && !Number.isFinite(value)))
    throw new Error(`${path} 必须是有效的 ${type} 值`);
}
export function parseNodePage(value: unknown): NodePage {
  if (
    !object(value) ||
    !Array.isArray(value.nodes) ||
    !Number.isInteger(value.total) ||
    Number(value.total) < 0
  )
    throw new Error('网关节点响应不符合接口契约');
  for (const node of value.nodes) {
    if (!object(node)) throw new Error('网关节点数据不是对象');
    for (const field of ['code', 'name', 'type', 'value'])
      requireType(node[field], 'string', `nodes.${field}`);
    if (!Number.isInteger(node.quality))
      throw new Error('节点质量码不符合接口契约');
  }
  return value as unknown as NodePage;
}
export function parseSimulationConfig(
  value: unknown,
  knownIDs?: Set<number>,
): SimulationConfig {
  if (
    !object(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.rules)
  )
    throw new Error('模拟方案必须包含 nodes 与 rules 数组');
  requireType(value.enabled, 'boolean', 'enabled');
  requireType(value.tickMs, 'number', 'tickMs');
  if (value.nodes.length > 10000 || value.rules.length > 200)
    throw new Error('模拟方案超过节点或规则数量上限');
  for (const [index, node] of value.nodes.entries()) {
    if (!object(node)) throw new Error(`nodes.${index} 不是对象`);
    for (const field of [
      'id',
      'baseline',
      'min',
      'max',
      'amplitude',
      'intervalMs',
    ])
      requireType(node[field], 'number', `nodes.${index}.${field}`);
    requireType(node.enabled, 'boolean', `nodes.${index}.enabled`);
    if (knownIDs && !knownIDs.has(Number(node.id)))
      throw new Error(
        `方案引用了当前目录中不存在的节点 ${node.id}，请先校正节点 ID`,
      );
  }
  for (const [index, rule] of value.rules.entries()) {
    if (
      !object(rule) ||
      !Array.isArray(rule.steps) ||
      !Array.isArray(rule.outputs)
    )
      throw new Error(`rules.${index} 缺少 steps 或 outputs`);
    for (const field of ['id', 'name'])
      requireType(rule[field], 'string', `rules.${index}.${field}`);
    requireType(rule.enabled, 'boolean', `rules.${index}.enabled`);
    requireType(rule.windowMs, 'number', `rules.${index}.windowMs`);
    for (const [i, step] of rule.steps.entries()) {
      if (!object(step)) throw new Error(`rules.${index}.steps.${i} 不是对象`);
      requireType(step.nodeId, 'number', `rules.${index}.steps.${i}.nodeId`);
      requireType(
        step.operator,
        'string',
        `rules.${index}.steps.${i}.operator`,
      );
      requireType(step.value, 'string', `rules.${index}.steps.${i}.value`);
    }
    for (const [i, output] of rule.outputs.entries()) {
      if (!object(output))
        throw new Error(`rules.${index}.outputs.${i} 不是对象`);
      for (const field of ['nodeId', 'target', 'delayMs', 'durationMs'])
        requireType(
          output[field],
          'number',
          `rules.${index}.outputs.${i}.${field}`,
        );
    }
  }
  return value as unknown as SimulationConfig;
}

export interface LogEntry {
  id: number;
  time: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  component: string;
  machine?: string;
  requestId?: string;
  fields: Record<string, string>;
  truncated?: boolean;
}
export interface LogPage {
  entries: LogEntry[];
  total: number;
  offset: number;
  limit: number;
  anchor: number;
  latestId: number;
  oldestId: number;
  instanceId: string;
  capturedAt: string;
  startedAt: string;
  retained: number;
  capacity: number;
  bytes: number;
  byteBudget: number;
  discarded: number;
  components: string[];
  machines: string[];
  levels: Record<string, number>;
  source: 'memory';
}
export function parseLogPage(value: unknown): LogPage {
  if (
    !object(value) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 200 ||
    value.source !== 'memory'
  )
    throw new Error('日志接口响应格式不正确，请更新配套 Go 服务');
  for (const key of [
    'total',
    'offset',
    'limit',
    'anchor',
    'latestId',
    'oldestId',
    'retained',
    'capacity',
    'bytes',
    'byteBudget',
    'discarded',
  ]) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)
      throw new Error(`日志响应 ${key} 无效`);
  }
  for (const key of ['instanceId', 'capturedAt', 'startedAt'])
    requireType(value[key], 'string', key);
  for (const key of ['components', 'machines'])
    if (
      !Array.isArray(value[key]) ||
      !value[key].every((item: unknown) => typeof item === 'string')
    )
      throw new Error(`日志响应 ${key} 无效`);
  const levels = value.levels;
  if (
    !object(levels) ||
    !['DEBUG', 'INFO', 'WARN', 'ERROR'].every(
      (level) =>
        Number.isSafeInteger(levels[level]) && Number(levels[level]) >= 0,
    )
  )
    throw new Error('日志级别统计无效');
  for (const entry of value.entries) {
    if (
      !object(entry) ||
      !Number.isSafeInteger(entry.id) ||
      Number(entry.id) < 1 ||
      !['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(String(entry.level)) ||
      !object(entry.fields) ||
      !Object.values(entry.fields).every((field) => typeof field === 'string')
    )
      throw new Error('日志条目响应无效');
    for (const key of ['time', 'message', 'component'])
      requireType(entry[key], 'string', key);
    for (const key of ['machine', 'requestId'])
      if (entry[key] !== undefined) requireType(entry[key], 'string', key);
    if (Number.isNaN(Date.parse(entry.time as string)))
      throw new Error('日志时间无效');
  }
  return value as unknown as LogPage;
}
