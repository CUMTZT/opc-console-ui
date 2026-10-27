/**
 * 网关业务容器：自动连接、状态采样、配置草稿、历史版本与配置操作都在这里协调。
 * 节点读写逻辑委托给 useGatewayNodes，表单交给 Configuration，差异交给 ConfigReview。
 * 这是“状态放在共同父组件，再通过 props 和回调共享”的实际例子。
 */
import ConfigReview from './features/gateway-config/ConfigReview.jsx';
import Diagnostics from './features/gateway-status/Diagnostics.jsx';
import GatewayNodes from './features/gateway-nodes/GatewayNodes.jsx';
import { useGatewayNodes } from './features/gateway-nodes/useGatewayNodes.js';
import { useEffect, useRef, useState } from 'react';
import Configuration from './Configuration.jsx';
import Icon from './components/Icon.jsx';
import {
  Alert,
  Badge,
  Metric,
  errorText,
  download,
  isCancelled,
  number,
  request,
  time,
  usePolling,
  useVisible,
} from './shared.jsx';

// 采集网关四个业务子页面的标题映射表。
const titles = {
  overview: '运行总览',
  nodes: '节点监控',
  connections: '连接配置',
  settings: '网关设置',
};
/** 把热重载计划转换为可读说明；返回文本只描述计划，不代表重连已完成。 */
function planText(plan) {
  // 将后端热重载计划转成中文；filter(Boolean) 去掉没有发生的变更项。
  return (
    [
      plan?.kafkaChanged && '重建 Kafka 发布器',
      ...[
        ['addedMachines', '新增'],
        ['removedMachines', '移除'],
        ['restartedMachines', '重连'],
      ].map(([key, label]) =>
        plan?.[key]?.length ? `${label} ${plan[key].length} 个机组` : '',
      ),
    ]
      .filter(Boolean)
      .join('，') || '采集连接无需重启'
  );
}

/**
 * samples：按时间顺序排列的 {at, ok, failed} 数组，由父级状态采样生成。
 * max 至少为 2，避免所有增量为 0 时除以 0；两条线共用尺度，便于比较成功与失败。
 * SVG 的 M 表示移动起点、L 表示连线，x 坐标随采样下标均匀分布。
 */
function DeliveryChart({ samples }) {
  // 用原生 SVG 绘图：将最近采样映射到固定 viewBox；这里没有额外图表库。
  // samples 是相邻两次计数之差，不是总量，也没有除以时间换算成每秒速率。
  const max = Math.max(2, ...samples.flatMap((p) => [p.ok, p.failed]));
  // 原点在 SVG 左上角，所以值越大 y 越小；底边 152 与顶部留白共同构成可视范围。
  const path = (key) =>
    samples
      .map(
        (p, i) =>
          `${i ? 'L' : 'M'}${(i * 760) / Math.max(1, samples.length - 1)},${152 - (p[key] / max) * 140}`,
      )
      .join(' ');
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>投递趋势</h2>
        <div className="chart-legend">
          <span>
            <i />
            成功
          </span>
          <span>
            <i className="failed" />
            失败
          </span>
        </div>
      </div>
      <div className="panel-content">
        {samples.length ? (
          <>
            <svg
              className="chart"
              viewBox="0 0 760 160"
              role="img"
              aria-label="Kafka 成功与失败投递趋势"
            >
              {[12, 82, 152].map((y) => (
                <path
                  key={y}
                  d={`M0,${y}H760`}
                  stroke="#e6edf3"
                  strokeWidth="1"
                />
              ))}
              <path d={`${path('ok')} L760,152 L0,152 Z`} fill="#e4f6ee" />
              <path
                d={path('ok')}
                fill="none"
                stroke="#0d9488"
                strokeWidth="2"
              />
              <path
                d={path('failed')}
                fill="none"
                stroke="#d25550"
                strokeWidth="2"
              />
            </svg>
            <div className="chart-label">
              <span>{time(samples[0].at)}</span>
              <span>成功 / 失败 · 最大值 {max}</span>
              <span>{time(samples.at(-1).at)}</span>
            </div>
          </>
        ) : (
          <p className="empty">正在采样，首组数据将在下一次状态刷新后显示。</p>
        )}
        <p>最近 30 次采样 · 当前会话的批次数变化</p>
      </div>
    </section>
  );
}

/**
 * active/page/navigate 由 App 提供；observe=true 表示总览仍需要网关摘要。
 * onStatus 把成功或过期状态交回 App，供 Overview 显示，是子级向父级报告数据的回调。
 * ready/connectionError：首次管理连接及能力检查结果；status/statusError：持续状态刷新结果。
 * history：当前会话图表采样，不是配置历史；configHistory 才是后端保存的版本摘要。
 * saving/result/fieldError：配置操作忙碌、结果提示和应聚焦的错误字段路径。
 * pendingPlan：当前草稿最近一次校验计划；application：最近一次成功应用的记录。
 * machine：当前节点页机组编码；session/lastCounters/form 分别是取消器、计数基线、表单引用。
 */
export default function Gateway({
  active,
  page,
  navigate,
  observe = false,
  onStatus,
}) {
  // ready 表示管理接口已完成能力检查，不等于设备连接、采集就绪或 Kafka 投递成功。
  const [ready, setReady] = useState(false),
    [connectionError, setConnectionError] = useState('');
  const [status, setStatus] = useState(null),
    [statusError, setStatusError] = useState(''),
    [history, setHistory] = useState([]);
  const [view, setView] = useState(null),
    [config, setConfig] = useState(null),
    [saving, setSaving] = useState(false),
    [result, setResult] = useState(null);
  // view.config 是已读文件基线；config 是表单草稿；runningConfig 是实际运行配置。
  // 三份数据分开才能表达“草稿未保存”和“文件已保存但尚未应用”两种不同状态。
  const [machine, setMachine] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [runningConfig, setRunningConfig] = useState(null),
    [configHistory, setConfigHistory] = useState([]),
    [reviewError, setReviewError] = useState(''),
    [pendingPlan, setPendingPlan] = useState(null),
    [application, setApplication] = useState(null);
  useEffect(() => {
    // 草稿变化后，上一次校验的热应用计划已经过时，不能继续当作当前草稿的计划展示。
    setPendingPlan(null);
  }, [config]);
  const session = useRef(new AbortController()),
    lastCounters = useRef(null),
    form = useRef(null);
  // dirty 只比较可序列化配置内容；view 是元数据包装，不应拿它整体和草稿比较。
  const visible = useVisible(),
    dirty = !!view && JSON.stringify(config) !== JSON.stringify(view.config);
  // 机组列表以运行状态为准，而不是未应用的表单草稿；否则会对不存在的运行机组发操作。
  const machines = status?.machines || [],
    allowWrite = !!status && !status.readOnly && !statusError;
  useEffect(() => {
    // 会话级取消信号覆盖 api 发起的请求；组件卸载时统一中止等待。
    // 中止 HTTP 等待不代表设备端操作已经撤销，写入失败后仍需回读确认。
    const controller = new AbortController();
    session.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    // 浏览器离开提醒保护草稿；内部 Hash 导航保留 Gateway 本身，因此无需重新载入。
    const listener = (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  /** 采集网关专用请求封装：自动拼接 /api/gateway 前缀、合并会话取消信号并拆包 data 字段。 */
  async function api(path, options = {}) {
    // 网关采用 {code, message, data} 包装，业务组件只取 data；模拟服务直接返回对象。
    const response = await request('/api/gateway' + path, {
      ...options,
      signal: AbortSignal.any([
        session.current.signal,
        ...(options.signal ? [options.signal] : []),
      ]),
    });
    return response?.data;
  }
  // 首次连接仅在 !ready 时读取配置，不把每五秒状态查询变成覆盖草稿的配置重载。
  const refreshConnection = usePolling(
    async (signal) => {
      try {
        const [configuration, capabilities] = await Promise.all([
          api('/config', { signal }),
          api('/capabilities', { signal }),
        ]);
        // 先确认缓存与直接回读能力，再开放依赖这些能力的界面；失败后 5 秒再尝试。
        if (
          capabilities?.apiVersion !== '1' ||
          !capabilities?.directReadback ||
          !capabilities?.monitorSources?.includes('cache')
        )
          throw new Error(
            '网关版本不兼容，请更新到支持订阅缓存和写后回读的版本（1.1.0 或更新版本）。',
          );
        setView(configuration);
        setConfig(structuredClone(configuration.config));
        setConnectionError('');
        // ready 置为 true 后此初始化轮询停止，后面的状态轮询开始工作。
        setReady(true);
      } catch (error) {
        if (!isCancelled(error)) {
          setConnectionError(
            '无法连接采集网关，将自动重试。' + errorText(error),
          );
          onStatus?.({ stale: true, error: errorText(error) });
        }
      }
    },
    5000,
    (active || observe) && visible && !ready,
  );
  // 持续状态轮询：每 5 秒同步网关运行摘要、计算 Kafka 投递增量并维护默认选中机组。
  const refreshStatus = usePolling(
    async (signal) => {
      if (!ready) return;
      try {
        const data = await api('/status', { signal });
        // 一次成功响应同时更新本页和父级摘要，两个区域不会使用两套独立轮询结果。
        setStatus(data);
        onStatus?.(data);
        setStatusError('');
        const counters = lastCounters.current;
        // 从累计计数计算本次增量，只保留当前浏览会话最近 30 次采样，不写入后端。
        if (counters)
          setHistory((previous) =>
            [
              ...previous,
              {
                at: Date.now(),
                // 服务重启导致累计计数回落时，截断负增量，避免图表出现负投递量。
                ok: Math.max(0, data.kafka.successfulBatches - counters.ok),
                failed: Math.max(0, data.kafka.failedBatches - counters.failed),
              },
              // 只保留末尾 30 项，避免长时间打开页面时采样数组无限增长。
            ].slice(-30),
          );
        lastCounters.current = {
          ok: data.kafka.successfulBatches,
          failed: data.kafka.failedBatches,
        };
        setMachine((current) =>
          // 保留仍存在的当前机组；机组被移除时才退回第一个可用机组。
          data.machines.some((m) => m.code === current)
            ? current
            : data.machines[0]?.code || '',
        );
      } catch (e) {
        if (!isCancelled(e)) {
          setStatusError(
            '状态刷新失败，当前显示最近一次成功读取的数据。' + errorText(e),
          );
          // 保留最后一次状态并显式标记 stale，避免网络异常时旧正常值继续冒充实时正常。
          onStatus?.({ ...status, stale: true, error: errorText(e) });
        }
      }
    },
    5000,
    (active || observe) && visible && ready,
    ready,
  );
  // Hook 在 Gateway 的固定位置调用，即使节点子页面暂时没有渲染，其状态仍可保留。
  const nodeState = useGatewayNodes({
    api,
    enabled: ready,
    active: active && page === 'nodes',
    machine,
    allowWrite,
    refreshStatus,
  });
  useEffect(() => {
    // 后端状态轮询驱动重新发现流程：目录替换后，还要等待新快照确认才算就绪。
    nodeState.updateScan(machines);
  }, [status]);
  // 配置审阅轮询：仅在连接配置或网关设置子页每 5 秒刷新运行态配置与历史版本列表。
  const refreshReview = usePolling(
    async (signal) => {
      if (!ready) return;
      try {
        const [running, history] = await Promise.all([
          api('/config/current', { signal }),
          api('/config/history', { signal }),
        ]);
        // 这里只更新运行态和历史列表，绝不把定时读取的结果写进正在编辑的 config。
        setRunningConfig(running);
        setConfigHistory(history);
        setReviewError('');
      } catch (error) {
        if (!isCancelled(error)) setReviewError(errorText(error));
      }
    },
    5000,
    active && visible && ready && ['connections', 'settings'].includes(page),
    ready,
  );
  /** 载入指定历史版本配置为本地可编辑草稿，保留当前文件的 revision 以备后续保存。 */
  async function loadHistory(id) {
    // 历史内容变成可编辑草稿；revision 仍取当前文件，历史版本不会立即替换运行连接。
    if (dirty && !window.confirm('载入历史版本会替换当前草稿，确认继续？'))
      return;
    setSaving(true);
    try {
      const [saved, current] = await Promise.all([
        api('/config/history/' + encodeURIComponent(id)),
        api('/config'),
      ]);
      setView(current);
      setConfig(structuredClone(saved.config));
      setResult({
        kind: 'info',
        text: '历史配置已载入草稿，请检查差异、校验后再保存。',
      });
    } catch (error) {
      setReviewError(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  /** 统一执行网关配置的重新读取（read）、重载文件（reload）、预校验（validate）、仅保存（save）与热应用（apply）。 */
  async function configurationAction(action) {
    // 同一入口区分 read / reload / validate / save / apply，具体语义不能互相替代。
    // 事件入口也检查 busy，而不只依赖按钮 disabled，避免同一操作在处理中重复启动。
    if (saving) return;
    if (action === 'read' || action === 'reload') {
      if (
        dirty &&
        !window.confirm('当前配置尚未保存，确认丢弃草稿并重新读取？')
      )
        return;
    }
    if (
      ['save', 'apply', 'validate'].includes(action) &&
      // 原生约束校验会聚焦不合法控件；read/reload 不要求当前草稿先合法。
      !form.current?.reportValidity()
    )
      return;
    const submitted = structuredClone(config);
    // 在提交副本上清理证书路径空行，不直接改动用户正在看的 React state。
    for (const key of ['trust_list_files', 'revocation_list_files'])
      submitted.opc.security[key] = submitted.opc.security[key]
        .map((value) => value.trim())
        .filter(Boolean);
    // 一次配置动作建立独立的结果展示周期，清掉上次提示，不清掉用户草稿。
    setSaving(true);
    setResult(null);
    setFieldError('');
    try {
      if (action === 'validate') {
        // 预校验只返回影响计划，不保存文件、不切换连接。
        const plan = await api('/config/validate', {
          method: 'POST',
          body: { config: submitted },
        });
        setPendingPlan(plan);
        setResult({
          text: '配置校验通过。' + planText(plan) + '。',
          kind: 'success',
        });
      } else if (action === 'read' || action === 'reload') {
        // read 只读取磁盘文件；reload 先让 Go 重载文件到运行态，再读取文件视图。
        let plan;
        if (action === 'reload')
          plan = await api('/config/reload', { method: 'POST' });
        const next = await api('/config');
        setView(next);
        setConfig(structuredClone(next.config));
        setResult({
          text:
            action === 'reload'
              ? '文件已重载。' + planText(plan) + '。'
              : '已重新读取配置文件。',
          kind: 'success',
        });
        refreshStatus();
        refreshReview();
      } else {
        // save/apply 都做 revision 检查，apply=true 额外要求后端切换运行配置。
        const data = await api('/config', {
          method: 'PUT',
          body: {
            config: submitted,
            // 使用文件基线版本，不使用历史版本 ID；409 时仍保留这份提交草稿供用户比较。
            revision: view.revision,
            apply: action === 'apply',
          },
        });
        if (data.applied)
          setApplication({ plan: data.plan, at: new Date().toISOString() });
        setView(data.configuration);
        setConfig(structuredClone(data.configuration.config));
        setResult({
          text: data.applied
            ? '配置已保存并应用。' + planText(data.plan) + '。'
            : '配置已保存，文件配置尚未应用。当前连接继续使用原配置，可稍后重载文件或重启网关。',
          kind: data.applied ? 'success' : 'info',
        });
        refreshStatus();
        refreshReview();
      }
    } catch (e) {
      // 后端字段路径映射到表单的 data-config-path，必要时导航到对应子页并聚焦。
      // 优先采用结构化 data.field，旧格式才从错误文本提取；统一兼容 kafka 字段前缀。
      const field = (
        e.data?.field ||
        e.message?.match(
          /\b((?:opc|kafka_producer|kafka)\.[a-z0-9_.]+|station_code)\b/,
        )?.[1] ||
        ''
      ).replace(/^kafka\./, 'kafka_producer.');
      if (field) {
        setFieldError(field);
        const settings =
          field === 'station_code' ||
          (field.startsWith('opc.') && !field.startsWith('opc.machines.'));
        navigate(settings ? 'gateway/settings' : 'gateway/connections');
        // 导航后要等 React 更新出目标页面再查询 DOM；CSS.escape 避免路径被当作选择器语法。
        requestAnimationFrame(() =>
          document
            .querySelector(`[data-config-path="${CSS.escape(field)}"]`)
            ?.focus(),
        );
      }
      if (!isCancelled(e))
        // 409 和应用回滚都只更新提示，不覆盖 config；用户可以保留草稿继续处理。
        setResult({
          kind: 'danger',
          text:
            e.status === 409
              ? '配置版本冲突，当前草稿已保留，请重新读取最新配置后编辑。'
              : e.data?.fileRestored
                ? `热应用失败，原配置文件已恢复，草稿已保留。可点击“仅保存”，稍后重载或重启。${errorText(e)}`
                : errorText(e) +
                  ' 操作结果未确认时，请重新读取配置后再决定是否重试。',
        });
    } finally {
      setSaving(false);
    }
  }
  // 只让当前组件本次输出 null，不会让父组件卸载 Gateway，Hooks 的 state 仍然保留。
  // 所有 Hook 都在这条提前返回之前调用，保证每次渲染时调用顺序一致。
  if (!active) return null;
  const k = status?.kafka || {},
    connection = status?.kafkaConnection || {},
    online = machines.filter((m) => m.connected).length;
  // JSX 按 page 组合不同子页面；子组件通过 setConfig 等回调更新本容器拥有的状态。
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OPC UA → KAFKA</div>
          <h1>{titles[page]}</h1>
          <p>
            {status?.stationCode || '采集网关管理'} ·{' '}
            {ready ? '自动连接' : '正在连接网关…'}
          </p>
        </div>
        <div className="heading-actions">
          <Badge
            kind={
              statusError
                ? 'bad'
                : status?.readOnly
                  ? 'warn'
                  : status
                    ? 'good'
                    : ''
            }
          >
            {statusError
              ? '数据已过期'
              : status?.readOnly
                ? '设备只读'
                : status
                  ? '读写模式'
                  : '未连接'}
          </Badge>
          <button
            className="button"
            onClick={ready ? refreshStatus : refreshConnection}
          >
            <Icon name="refresh" size={14} />
            刷新状态
          </button>
        </div>
      </div>
      <Alert>{connectionError || statusError}</Alert>
      {/* 应用请求成功与运行连接全部就绪是两件事，后者还需等待持续状态刷新确认。 */}
      {application && (
        <Alert kind={machines.every((m) => m.ready) ? 'success' : 'info'}>
          配置已应用；
          {machines.every((m) => m.ready)
            ? '运行连接已就绪'
            : '正在等待连接及新快照确认，请查看运行诊断。'}
        </Alert>
      )}
      {/* 运行总览仅使用 status/history；此处不会直接连接 OPC UA 或 Kafka。 */}
      {page === 'overview' && (
        <>
          <section className="metrics">
            <Metric
              icon="network"
              label="在线 OPC UA 机组"
              value={status ? `${online} / ${machines.length}` : '—'}
              hint="以运行中的连接为准"
            />
            <Metric
              icon="database"
              label="发现节点数"
              value={
                status
                  ? number(machines.reduce((sum, m) => sum + m.nodeCount, 0))
                  : '—'
              }
              hint="所有采集机组"
            />
            <Metric
              icon="send"
              kind="good"
              label="成功投递批次"
              value={status ? number(k.successfulBatches) : '—'}
              hint={`${number(k.failedBatches)} 失败批次`}
            />
            <Metric
              icon="activity"
              kind={k.unknownBatches ? 'warn' : ''}
              label="在途消息"
              value={status ? number(k.queuedMessages) : '—'}
              hint={`${number(k.unknownBatches)} 批次结果未知`}
            />
          </section>
          <div className="split">
            <DeliveryChart samples={history} />
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <Icon name="network" size={17} />
                  数据链路
                </h2>
                <Badge
                  kind={connection.state === 'connected' ? 'good' : 'warn'}
                >
                  {connection.state === 'connected'
                    ? 'Kafka 已连接'
                    : connection.state === 'disconnected'
                      ? 'Kafka 连接失败'
                      : '待检测'}
                </Badge>
              </div>
              <div className="panel-content">
                <div className="connection-line">
                  <span>OPC UA → 网关</span>
                  <strong>{online} 个在线机组</strong>
                </div>
                <div className="connection-line">
                  <span>网关 → Kafka</span>
                  <span className="mono">{status?.kafkaBrokers || '—'}</span>
                </div>
                <div className="connection-line">
                  <span>协议探测延迟</span>
                  <strong>
                    {connection.state === 'connected'
                      ? `${number(connection.latencyMs)} ms`
                      : '—'}
                  </strong>
                </div>
                <p>最近探测 {time(connection.checkedAt)}</p>
                <p>
                  Broker 可响应不代表 Topic
                  权限与消息确认正常，请结合投递指标判断。
                </p>
              </div>
            </section>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <Icon name="server" size={17} />
                采集机组
              </h2>
              <small>最近刷新 {time(status?.serverTime)}</small>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>机组 / 服务地址</th>
                    <th>状态</th>
                    <th>节点数</th>
                    <th>Topic</th>
                    <th>最近确认</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.map((m) => (
                    <tr key={m.code}>
                      <td>
                        <strong>{m.code}</strong>
                        <small className="mono">{m.server}</small>
                      </td>
                      <td>
                        <Badge
                          kind={m.ready ? 'good' : m.connected ? 'warn' : 'bad'}
                        >
                          {m.ready
                            ? '采集就绪'
                            : m.connected
                              ? '已连接 · 准备中'
                              : '未连接'}
                        </Badge>
                        {m.lastError && <small>{m.lastError}</small>}
                      </td>
                      <td>{number(m.nodeCount)}</td>
                      <td className="mono">{m.topic}</td>
                      <td>{time(m.lastAckTime)}</td>
                      <td>
                        <button
                          className="button small"
                          disabled={!m.connected}
                          onClick={() => {
                            setMachine(m.code);
                            navigate('gateway/nodes');
                          }}
                        >
                          查看节点
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!machines.length && (
                <p className="empty">等待网关状态，暂无机组数据。</p>
              )}
            </div>
          </section>
        </>
      )}
      {/* 诊断与总览指标复用同一运行机组数组，避免独立请求产生前后口径不一致。 */}
      {page === 'overview' && <Diagnostics machines={machines} />}
      {/* 节点界面可能随路由卸载，Hook 状态仍属于 Gateway，因此待回读操作不会随界面消失。 */}
      {page === 'nodes' && (
        <GatewayNodes
          state={nodeState}
          machine={machine}
          setMachine={setMachine}
          machines={machines}
          readOnly={status?.readOnly}
        />
      )}
      {/* 两个配置子页共用 config；先有文件视图再渲染表单，避免子组件读到 null 草稿。 */}
      {['connections', 'settings'].includes(page) && view && (
        <form
          ref={form}
          className="gateway-config-form"
          onSubmit={(e) => {
            e.preventDefault();
            configurationAction('apply');
          }}
        >
          <Alert kind={dirty || !view.inSync ? 'info' : 'success'}>
            {dirty
              ? '有未保存的修改'
              : !view.inSync
                ? '文件配置尚未应用'
                : '配置已同步'}{' '}
            · {view.file} · TOML
          </Alert>
          {/* 把草稿与更新入口交给子组件，实际校验/保存接口仍集中在 Gateway。 */}
          <Configuration
            config={config}
            setConfig={setConfig}
            page={page}
            disabled={saving}
            fieldError={fieldError}
          />
          {/* 对照基线、草稿和运行态；定时审阅只更新旁边信息，不替换正在编辑的字段。 */}
          <ConfigReview
            draft={config}
            baseline={view.config}
            running={runningConfig}
            plan={pendingPlan}
            history={configHistory}
            error={reviewError}
            onLoad={loadHistory}
            onExport={() =>
              download(
                'gateway-draft.json',
                JSON.stringify(config, null, 2),
                'application/json',
              )
            }
            busy={saving}
          />
          <Alert kind={result?.kind}>{result?.text}</Alert>
          {/* 仅保存与保存并应用明确分开；后者是 form 的 submit 默认动作。 */}
          <div className="config-actions">
            <div className="actions">
              <button
                type="button"
                className="button"
                disabled={saving}
                onClick={() => configurationAction('read')}
              >
                重新读取
              </button>
              <button
                type="button"
                className="button"
                disabled={saving}
                onClick={() => configurationAction('reload')}
              >
                重载文件
              </button>
              <button
                type="button"
                className="button"
                disabled={saving}
                onClick={() => configurationAction('validate')}
              >
                校验配置
              </button>
              <button
                type="button"
                className="button"
                disabled={saving || !view.canSave || (!dirty && view.inSync)}
                onClick={() => configurationAction('save')}
              >
                仅保存
              </button>
              <button
                className="button primary"
                disabled={saving || !view.canSave || (!dirty && view.inSync)}
              >
                {saving ? '正在处理…' : '保存并应用'}
              </button>
            </div>
            <p>
              仅保存不会切换运行连接；保存会重新序列化
              TOML，不保留原文件注释与排版。
            </p>
          </div>
        </form>
      )}
    </>
  );
}
