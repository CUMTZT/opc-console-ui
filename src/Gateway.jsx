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

const titles = {
  overview: '运行总览',
  nodes: '节点监控',
  connections: '连接配置',
  settings: '网关设置',
};
function planText(plan) {
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

function DeliveryChart({ samples }) {
  const max = Math.max(2, ...samples.flatMap((p) => [p.ok, p.failed]));
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

export default function Gateway({
  active,
  page,
  navigate,
  observe = false,
  onStatus,
}) {
  const [ready, setReady] = useState(false),
    [connectionError, setConnectionError] = useState('');
  const [status, setStatus] = useState(null),
    [statusError, setStatusError] = useState(''),
    [history, setHistory] = useState([]);
  const [view, setView] = useState(null),
    [config, setConfig] = useState(null),
    [saving, setSaving] = useState(false),
    [result, setResult] = useState(null);
  const [machine, setMachine] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [runningConfig, setRunningConfig] = useState(null),
    [configHistory, setConfigHistory] = useState([]),
    [reviewError, setReviewError] = useState(''),
    [pendingPlan, setPendingPlan] = useState(null),
    [application, setApplication] = useState(null);
  useEffect(() => {
    setPendingPlan(null);
  }, [config]);
  const session = useRef(new AbortController()),
    lastCounters = useRef(null),
    form = useRef(null);
  const visible = useVisible(),
    dirty = !!view && JSON.stringify(config) !== JSON.stringify(view.config);
  const machines = status?.machines || [],
    allowWrite = !!status && !status.readOnly && !statusError;
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const listener = (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  async function api(path, options = {}) {
    const response = await request('/api/gateway' + path, {
      ...options,
      signal: AbortSignal.any([
        session.current.signal,
        ...(options.signal ? [options.signal] : []),
      ]),
    });
    return response?.data;
  }
  const refreshConnection = usePolling(
    async (signal) => {
      try {
        const [configuration, capabilities] = await Promise.all([
          api('/config', { signal }),
          api('/capabilities', { signal }),
        ]);
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
  const refreshStatus = usePolling(
    async (signal) => {
      if (!ready) return;
      try {
        const data = await api('/status', { signal });
        setStatus(data);
        onStatus?.(data);
        setStatusError('');
        const counters = lastCounters.current;
        if (counters)
          setHistory((previous) =>
            [
              ...previous,
              {
                at: Date.now(),
                ok: Math.max(0, data.kafka.successfulBatches - counters.ok),
                failed: Math.max(0, data.kafka.failedBatches - counters.failed),
              },
            ].slice(-30),
          );
        lastCounters.current = {
          ok: data.kafka.successfulBatches,
          failed: data.kafka.failedBatches,
        };
        setMachine((current) =>
          data.machines.some((m) => m.code === current)
            ? current
            : data.machines[0]?.code || '',
        );
      } catch (e) {
        if (!isCancelled(e)) {
          setStatusError(
            '状态刷新失败，当前显示最近一次成功读取的数据。' + errorText(e),
          );
          onStatus?.({ ...status, stale: true, error: errorText(e) });
        }
      }
    },
    5000,
    (active || observe) && visible && ready,
    ready,
  );
  const nodeState = useGatewayNodes({
    api,
    enabled: ready,
    active: active && page === 'nodes',
    machine,
    allowWrite,
    refreshStatus,
  });
  useEffect(() => {
    nodeState.updateScan(machines);
  }, [status]);
  const refreshReview = usePolling(
    async (signal) => {
      if (!ready) return;
      try {
        const [running, history] = await Promise.all([
          api('/config/current', { signal }),
          api('/config/history', { signal }),
        ]);
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
  async function loadHistory(id) {
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
  async function configurationAction(action) {
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
      !form.current?.reportValidity()
    )
      return;
    const submitted = structuredClone(config);
    for (const key of ['trust_list_files', 'revocation_list_files'])
      submitted.opc.security[key] = submitted.opc.security[key]
        .map((value) => value.trim())
        .filter(Boolean);
    setSaving(true);
    setResult(null);
    setFieldError('');
    try {
      if (action === 'validate') {
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
        const data = await api('/config', {
          method: 'PUT',
          body: {
            config: submitted,
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
        requestAnimationFrame(() =>
          document
            .querySelector(`[data-config-path="${CSS.escape(field)}"]`)
            ?.focus(),
        );
      }
      if (!isCancelled(e))
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
  if (!active) return null;
  const k = status?.kafka || {},
    connection = status?.kafkaConnection || {},
    online = machines.filter((m) => m.connected).length;
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
      {application && (
        <Alert kind={machines.every((m) => m.ready) ? 'success' : 'info'}>
          配置已应用；
          {machines.every((m) => m.ready)
            ? '运行连接已就绪'
            : '正在等待连接及新快照确认，请查看运行诊断。'}
        </Alert>
      )}
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
      {page === 'overview' && <Diagnostics machines={machines} />}
      {page === 'nodes' && (
        <GatewayNodes
          state={nodeState}
          machine={machine}
          setMachine={setMachine}
          machines={machines}
          readOnly={status?.readOnly}
        />
      )}
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
          <Configuration
            config={config}
            setConfig={setConfig}
            page={page}
            disabled={saving}
            fieldError={fieldError}
          />
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
