/**
 * 接口契约与边界校验。本文件同时包含 TypeScript 类型和运行时执行的 parse* 函数。
 * interface 只在开发时检查，构建后会被移除；网络 JSON 和本地导入仍需运行时校验。
 * 当前 JSX/JS 未开启 checkJs，所以 typecheck 通过不代表全部业务代码都获得严格类型检查。
 * 后端路由/字段/状态码变化需同步 Go OpenAPI、本文件及 tests/fixtures.js。
 */
/** 网关单节点值：value 用字符串保留协议表示；sourceTime 与最近观测时间含义不同。 */
export interface MonitoredNode {
  // 网关接口中的节点标识，例如 1:123；不是模拟服务整数 id 的同一种表示。
  code: string;
  // 节点显示名称，仅用于展示/搜索，不作为写入对象的唯一身份。
  name: string;
  // 后端报告的数据类型名称，界面用于展示写入上下文。
  type: string;
  // 节点值的文本表示，避免前端数值转换损失精度或特殊值信息。
  value: string;
  // OPC UA 原始质量码，最高两位表示 Good/Uncertain/Bad。
  quality: number;
  // 设备源时间；数值不变时它可能不更新，不能单独据此判断连接离线。
  sourceTime: string;
  // 可选：后端最近观测到该节点的时间，设备回读确认会检查它。
  observedAt?: string;
  // 可选：后端标记的节点陈旧状态，true 时界面限制写入。
  stale?: boolean;
}
/** 后端分页响应：catalogRevision 标识目录，capturedAt 标识缓存生成时间。 */
export interface NodePage {
  // 当前页节点数组，只是一页而不是该机组全部目录。
  nodes: MonitoredNode[];
  // 符合筛选条件的总节点数，用于计算还能否翻到下一页。
  total: number;
  // 当前页在过滤结果中的零起点偏移，25 表示从第 26 项开始。
  offset: number;
  // 本页请求/返回的分页容量，界面当前使用每页 25 项。
  limit: number;
  // 设备读取时间，区别于缓存响应的生成时间。
  readAt: string;
  // 可选：本次缓存/响应快照的生成时间，用于展示和新鲜度判断。
  capturedAt?: string;
  // 可选：true 表示订阅缓存，false 表示明确的设备直读结果。
  cached?: boolean;
  // 可选：后端返回该机组当前连接状态，不能替代完整采集就绪状态。
  connected?: boolean;
  // 可选：整页数据是否陈旧，和单节点 stale 一起限制写入。
  stale?: boolean;
  // 可选：目录版本标识，用于解释重新发现后的目录变化。
  catalogRevision?: string;
  // 可选：目录最近生成/更新时间，不是每条值变化的时间。
  catalogAt?: string;
}
/** 单节点动态参数；数值变化由 Go 模拟器计算，前端负责配置。 */
export interface SimulationProfile {
  // 模拟服务节点整数 ID，与导入时已知节点集合严格匹配。
  id: number;
  // 是否让该节点参与动态值模拟。
  enabled: boolean;
  // 动态值围绕的基准值，保存应用时启用节点可回到此值。
  baseline: number;
  // 允许的模拟下限，范围合法性由后端业务校验。
  min: number;
  // 允许的模拟上限，需要与 min、类型等约束配合。
  max: number;
  // 绝对波动幅度，0 表示固定控制量而非百分比。
  amplitude: number;
  // 该节点波动周期，单位毫秒，不是页面 HTTP 轮询间隔。
  intervalMs: number;
}
/** 有序触发步骤：节点、比较运算符和文本比较值。 */
export interface SimulationStep {
  // 此触发步骤监听的节点 ID。
  nodeId: number;
  // 比较运算符，如 changed/eq/gt；字符串结构检查后仍需后端校验枚举。
  operator: string;
  // 文本比较值；changed 模式无需比较值，其他模式由后端按节点类型解释。
  value: string;
}
/** 触发后的输出目标，支持延迟 delayMs 和渐变 durationMs。 */
export interface SimulationOutput {
  // 触发后要改变的输出节点 ID。
  nodeId: number;
  // 输出目标数值，具体类型和边界由后端验证。
  target: number;
  // 触发后延迟多久开始输出，单位毫秒。
  delayMs: number;
  // 从起始值渐变到目标的时长，单位毫秒。
  durationMs: number;
}
/** 一条业务规则由稳定 ID、匹配窗口、顺序步骤和执行输出组成。 */
export interface SimulationRule {
  // 规则稳定标识，用于列表 key 及与运行进度关联，名称变化不改变此 ID。
  id: string;
  // 规则可编辑名称，仅用于展示。
  name: string;
  // 是否启用这一条规则。
  enabled: boolean;
  // 完成有序步骤匹配所允许的时间窗口，单位毫秒。
  windowMs: number;
  // 按数组顺序执行匹配的触发步骤集合，顺序具有业务含义。
  steps: SimulationStep[];
  // 全部步骤匹配后需要执行的输出集合。
  outputs: SimulationOutput[];
}
/** 可保存/导入的模拟方案，不包含实时匹配进度和运行轨迹。 */
export interface SimulationConfig {
  // 全局动态模拟开关，和各节点/规则自己的 enabled 是不同层次。
  enabled: boolean;
  // 模拟服务内部刷新间隔，单位毫秒；不是浏览器刷新周期。
  tickMs: number;
  // 各个已配置节点的动态参数数组。
  nodes: SimulationProfile[];
  // 有序业务规则数组，运行进度不保存在这份编辑配置里。
  rules: SimulationRule[];
}
/** HTTP JSON 配置视图，最终由 Go 转换为 TOML；旧 HTTP 安全字段仅作兼容。 */
export interface GatewayConfiguration {
  // 站点编码，由后端用于网关配置与运行标识。
  station_code: string;
  // 共享 Kafka 发布器配置，多机组共用，前端不直接创建发布器。
  kafka_producer: {
    // Bootstrap Broker 地址文本，多个地址使用英文逗号分隔。
    brokers: string;
    // 单次投递等待预算，保留带单位的 Go 时长字符串。
    delivery_timeout: string;
    // 后端投递重试间隔，不代表前端重试设备写入。
    retry_delay: string;
    // 发布器最大重试次数，由后端执行并验证范围。
    max_retries: number;
  };
  // 采集、管理监听、缓冲及 OPC UA 安全相关配置。
  opc: {
    // HTTP 管理端口，页面只读；改动需要服务端重启。
    http_port: number;
    // HTTP 管理监听地址，页面只读；不要把它当作设备 Endpoint。
    http_bind_address: string;
    // 旧字段的反序列化兼容值，当前不参与管理 API 鉴权。
    allow_insecure_http: boolean;
    // 是否允许不加密的 OPC UA 连接，与 HTTP 管理接口是不同层次。
    allow_insecure_opcua: boolean;
    // 设备会话的重连间隔，带单位字符串。
    reconnect_interval: string;
    // OPC UA 订阅发布间隔，带单位字符串。
    publishing_interval: string;
    // 设备数据采样间隔，带单位字符串。
    sampling_interval: string;
    // OPC UA 订阅队列大小，不是页面分页条数。
    queue_size: number;
    // 首次快照前的通知排空窗口，带单位字符串。
    drain_timeout: string;
    // 进程退出协调的超时预算，带单位字符串。
    shutdown_timeout: string;
    // 增量通知合并窗口，决定网关聚合行为。
    aggregation_window: string;
    // 设备读写等操作的超时配置，不等同于浏览器 request 默认超时。
    operation_timeout: string;
    // 本地通知缓冲上限，由后端管理内存容量。
    local_buffer_size: number;
    // 待发送批次队列上限，单位是批次而非字节。
    send_queue_size: number;
    // 最大允许浏览的节点数，保护后端目录发现资源。
    max_nodes: number;
    // OPC UA 客户端安全配置，证书均为 Go 网关机器上的文件。
    security: {
      // 安全策略标识，如 none/basic256_sha256，协议值保持英文。
      policy: string;
      // 消息模式，如 none/sign/sign_and_encrypt，与 policy 组合使用。
      mode: string;
      // 客户端证书路径，浏览器只编辑路径文本，不上传文件。
      certificate_file: string;
      // 客户端私钥路径，私钥内容不经此表单读取。
      private_key_file: string;
      // 信任证书文件路径数组，表单用多行文本显示。
      trust_list_files: string[];
      // 吊销列表文件路径数组，提交副本会清掉空行。
      revocation_list_files: string[];
    };
    // 机组连接数组：code 是机组编码，server 是 OPC UA Endpoint，topic 是 Kafka Topic。
    machines: { code: string; server: string; topic: string }[];
  };
}
/** 运行时对象守卫：判断未知值是否为非空、非数组的普通键值对象。 */
function object(value: unknown): value is Record<string, unknown> {
  // unknown 表示尚未验证的外部值；类型谓词让后续 TypeScript 分支可以安全访问属性。
  // JavaScript 的 null 与数组也属于 typeof object；这里额外排除它们，限定为记录对象。
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
/** 基础类型断言：校验指定字段路径的值类型，数值类型额外拒绝 NaN 与无穷大。 */
function requireType(
  value: unknown,
  type: 'string' | 'boolean' | 'number',
  path: string,
): void {
  // typeof NaN 也是 number，因此还要额外检查数字是否有限。
  if (typeof value !== type || (type === 'number' && !Number.isFinite(value)))
    throw new Error(`${path} 必须是有效的 ${type} 值`);
}
/** 校验采集网关分页节点响应，确保分页计数与节点核心字段符合接口契约。 */
export function parseNodePage(value: unknown): NodePage {
  // 只验证目前显示节点所必需的结构，并非把 NodePage 的每个可选字段都完整验证。
  if (
    !object(value) ||
    // 先判断集合结构，再遍历项；total 用整数校验，避免字符串总数悄悄参与分页。
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
  // as 是告诉编译器采用指定类型，不执行转换；前面的 if/循环才是真正的运行时防线。
  return value as unknown as NodePage;
}
/** 校验模拟服务配置方案（用于 JSON 导入预检），核对节点参数、有序规则结构与已知节点 ID。 */
export function parseSimulationConfig(
  value: unknown,
  knownIDs?: Set<number>,
): SimulationConfig {
  // 导入文件是外部输入：先检查形状和数量，再检查节点/规则字段；业务范围交给后端。
  if (
    !object(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.rules)
  )
    throw new Error('模拟方案必须包含 nodes 与 rules 数组');
  requireType(value.enabled, 'boolean', 'enabled');
  requireType(value.tickMs, 'number', 'tickMs');
  // 限制导入数量以控制前端解析和后续请求规模；规则含义仍以 Go 校验为最终依据。
  if (value.nodes.length > 10000 || value.rules.length > 200)
    throw new Error('模拟方案超过节点或规则数量上限');
  // entries 同时提供原始位置和元素，使错误能准确指出 nodes.某下标.某字段。
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
    // 节点配置与规则都逐项检查；这里通过不代表比较运算符/引用关系等业务校验也通过。
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

/** 单条内存日志；fields 统一为字符串，避免视图对任意嵌套对象做隐式转换。 */
export interface LogEntry {
  // 当前后端进程内的日志序号，重启可能重新开始。
  id: number;
  // 日志时间字符串，解析校验通过后按浏览器本地时区显示。
  time: string;
  // 四种合法日志级别的联合类型，运行时仍要验证实际返回值。
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  // 日志正文，作为普通文本显示，不能当作 HTML 执行。
  message: string;
  // 日志模块名，default 映射为界面中的“未分类”。
  component: string;
  // 可选：日志关联的机组编码，模拟服务日志通常不使用。
  machine?: string;
  // 可选：HTTP 请求追踪编号，便于跨界面与服务端日志定位。
  requestId?: string;
  // 任意字段名到字符串值的映射，日志详情逐项展示。
  fields: Record<string, string>;
  // 可选：单条日志是否因预算限制被截断。
  truncated?: boolean;
}
/** 日志查询窗口：anchor 稳定翻页上界，instanceId 防止服务重启后误用旧游标。 */
export interface LogPage {
  // 当前页日志，按后端返回的接收顺序展示，最新优先。
  entries: LogEntry[];
  // 本次锚点及筛选窗口内的匹配总数，用于分页。
  total: number;
  // 当前页的零起点偏移，不是日志 ID。
  offset: number;
  // 分页容量，客户端常规使用 50。
  limit: number;
  // 历史翻页的固定 ID 上界，避免新日志追加导致页码窗口漂移。
  anchor: number;
  // 当前缓存中最新的日志 ID。
  latestId: number;
  // 当前缓存中最早仍保留的日志 ID。
  oldestId: number;
  // 后端进程实例标识，重启后旧 anchor 不能继续使用。
  instanceId: string;
  // 本次日志查询响应生成时间。
  capturedAt: string;
  // 后端进程启动时间，与单条日志 time 不同。
  startedAt: string;
  // 当前缓存保留条数，可能大于当前筛选的 total。
  retained: number;
  // 内存日志条数容量上限，达到后较早日志会被淘汰。
  capacity: number;
  // 当前缓存占用的日志文本字节统计。
  bytes: number;
  // 内存日志文本预算，界面会转换为 MiB 展示。
  byteBudget: number;
  // 较早或超限等未保留日志的计数。
  discarded: number;
  // 可用于模块筛选的名称列表。
  components: string[];
  // 可用于机组筛选的名称列表。
  machines: string[];
  // 各日志级别的非负计数映射。
  levels: Record<string, number>;
  // 固定 memory，明确本页查询的是进程内存日志而非磁盘完整历史。
  source: 'memory';
}
/** 校验内存运行日志分页响应，验证游标、容量预算、级别计数及结构化字段。 */
export function parseLogPage(value: unknown): LogPage {
  // 日志数据来自进程内存缓存；严格检查分页计数、枚举、结构化字段与条目时间。
  if (
    !object(value) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 200 ||
    value.source !== 'memory'
  )
    throw new Error('日志接口响应格式不正确，请更新配套 Go 服务');
  // 计数和游标必须在 JavaScript 安全整数范围内；浮点或超大整数会破坏分页身份。
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
  // 顶层属性先缩窄为记录对象，再逐个验证四种固定级别，避免缺少某级统计仍渲染成功。
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
