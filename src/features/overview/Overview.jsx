import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import {
  Alert,
  Badge,
  Metric,
  errorText,
  number,
  request,
  time,
  usePolling,
  useVisible,
} from '../../shared.jsx';

export default function Overview({ active, gateway }) {
  const [server, setServer] = useState(null),
    [error, setError] = useState('');
  const visible = useVisible();
  usePolling(
    async (signal) => {
      try {
        setServer(await request('/api/server/health', { signal }));
        setError('');
      } catch (e) {
        if (e.name !== 'AbortError') setError(errorText(e));
      }
    },
    5000,
    active && visible,
  );
  if (!active) return null;

  const machines = gateway?.machines || [];
  const observed = !!gateway?.serverTime,
    stale = !!gateway?.stale;
  const online = machines.filter((machine) => machine.connected).length;
  const ready = machines.filter((machine) => machine.ready).length;
  const kafka = gateway?.kafka || {};
  const probe = gateway?.kafkaConnection;
  const hasMachines = observed && machines.length > 0;
  const deviceGood = hasMachines && online === machines.length;
  const collectionGood = hasMachines && ready === machines.length;
  const kafkaGood = observed && probe?.state === 'connected';
  const serverGood = server?.state === 'running' && !error;
  const checksComplete = !!server && observed && !stale && !error;
  const allHealthy =
    checksComplete &&
    serverGood &&
    deviceGood &&
    collectionGood &&
    kafkaGood &&
    !kafka.unknownBatches;
  const attention = [
    stale && {
      title: '网关状态暂不可用',
      text: '检查采集网关服务与网络连接，等待状态恢复。',
      href: '#gateway/overview',
    },
    error && {
      title: '模拟服务暂不可达',
      text: '检查模拟服务是否启动，以及管理接口地址。',
      href: '#server/overview',
    },
    observed &&
      machines.length === 0 && {
        title: '尚未配置采集机组',
        text: '添加 OPC UA 连接后，即可开始采集。',
        href: '#gateway/connections',
      },
    hasMachines &&
      online < machines.length && {
        title: `${machines.length - online} 个机组未连接`,
        text: '检查设备地址、网络或 OPC UA 安全设置。',
        href: '#gateway/overview',
      },
    hasMachines &&
      online > ready && {
        title: `${online - ready} 个机组等待采集就绪`,
        text: '连接已经建立，继续确认首个快照与投递状态。',
        href: '#gateway/overview',
      },
    observed &&
      probe?.state === 'disconnected' && {
        title: 'Kafka 连接需要检查',
        text: '检查 Broker 地址与网络连通性。',
        href: '#gateway/connections',
      },
    kafka.unknownBatches > 0 && {
      title: `${number(kafka.unknownBatches)} 批消息结果未知`,
      text: '请结合投递与诊断记录确认恢复情况。',
      href: '#gateway/overview',
    },
  ].filter(Boolean);
  const stages = [
    {
      icon: 'cpu',
      title: '设备接入',
      value: observed
        ? `${online} / ${machines.length} 个机组在线`
        : '正在获取设备状态',
      good: deviceGood,
      bad: stale || (hasMachines && !online),
      badge: observed ? (deviceGood ? '连接正常' : '待连接') : '待检测',
    },
    {
      icon: 'server',
      title: '采集网关',
      value: observed ? `${ready} 个机组采集就绪` : '正在获取采集状态',
      good: collectionGood,
      bad: stale,
      badge: observed ? (collectionGood ? '采集就绪' : '准备中') : '待检测',
    },
    {
      icon: 'send',
      title: 'Kafka 投递',
      value: observed
        ? `${number(kafka.successfulBatches)} 批消息已确认`
        : '等待投递数据',
      good: kafkaGood,
      bad: stale || probe?.state === 'disconnected',
      badge: observed ? (kafkaGood ? '协议可响应' : '待确认') : '待检测',
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE OVERVIEW</div>
          <h1>系统总览</h1>
          <p>掌握设备接入、采集与消息投递的运行情况。</p>
        </div>
        <div className="heading-actions">
          <Badge
            kind={
              stale || error
                ? 'bad'
                : allHealthy
                  ? 'good'
                  : checksComplete
                    ? 'warn'
                    : ''
            }
          >
            {stale || error
              ? '运行状态需要检查'
              : allHealthy
                ? '数据链路运行正常'
                : checksComplete
                  ? '数据链路需要关注'
                  : '正在检测运行状态'}
          </Badge>
        </div>
      </div>
      <Alert>{error}</Alert>
      {stale && (
        <Alert>
          {observed ? '网关状态已过期：' : '暂时无法获取网关状态：'}
          {gateway.error}
          {observed
            ? '。以下保留最近一次成功状态。'
            : '。服务恢复后将自动更新。'}
        </Alert>
      )}
      <section className="metrics">
        <Metric
          icon="cpu"
          kind={error ? 'bad' : serverGood ? 'good' : ''}
          label="模拟服务"
          value={error ? '连接失败' : serverGood ? '运行中' : '待检测'}
          hint={`${server?.nodeCount ?? '—'} 个模拟节点`}
        />
        <Metric
          icon="network"
          kind={deviceGood ? 'good' : hasMachines ? 'warn' : ''}
          label="OPC UA 连接"
          value={observed ? `${online} / ${machines.length}` : '待检测'}
          hint="已建立连接 / 全部采集机组"
        />
        <Metric
          icon="activity"
          kind={collectionGood ? 'good' : hasMachines ? 'warn' : ''}
          label="采集就绪"
          value={observed ? `${ready} / ${machines.length}` : '—'}
          hint="首个快照已确认的采集机组"
        />
        <Metric
          icon="send"
          kind={kafkaGood ? 'good' : observed ? 'warn' : ''}
          label="Kafka 协议探测"
          value={kafkaGood ? '可响应' : observed ? '待确认' : '—'}
          hint={`最近探测 ${time(probe?.checkedAt)}`}
        />
      </section>
      <div className="overview-grid">
        <div className="overview-column">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <Icon name="network" size={17} />
                实时数据链路
              </h2>
              <span className="subtle">
                {observed
                  ? `最近同步 ${time(gateway.serverTime)}`
                  : '正在自动连接网关'}
              </span>
            </div>
            <ol className="pipeline" aria-label="采集数据链路">
              {stages.map((stage) => (
                <li
                  className={`pipeline-stage ${stage.bad ? 'is-bad' : !observed ? '' : stage.good ? 'is-good' : 'is-warn'}`}
                  key={stage.title}
                >
                  <span className="pipeline-icon">
                    <Icon name={stage.icon} size={23} />
                  </span>
                  <strong>{stage.title}</strong>
                  <small>{stage.value}</small>
                  <Badge
                    kind={
                      stage.bad
                        ? 'bad'
                        : !observed
                          ? ''
                          : stage.good
                            ? 'good'
                            : 'warn'
                    }
                  >
                    {stale ? (observed ? '状态过期' : '获取失败') : stage.badge}
                  </Badge>
                </li>
              ))}
            </ol>
            <p className="pipeline-footnote">
              连接、采集就绪与消息确认分别判断。Broker
              可响应时，仍需结合投递结果确认消息是否送达。
            </p>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <Icon name="server" size={17} />
                采集机组 <Badge>{machines.length}</Badge>
              </h2>
              <a className="button link" href="#gateway/overview">
                查看全部
                <Icon name="arrowRight" size={14} />
              </a>
            </div>
            {machines.slice(0, 4).map((machine) => (
              <div className="overview-machine" key={machine.code}>
                <div className="machine-heading">
                  <Icon name="server" size={19} />
                  <div>
                    <strong>{machine.code}</strong>
                    <small>
                      {number(machine.nodeCount)} 个节点 · 最近确认{' '}
                      {time(machine.lastAckTime)}
                    </small>
                  </div>
                </div>
                <Badge
                  kind={
                    stale
                      ? 'warn'
                      : machine.ready
                        ? 'good'
                        : machine.connected
                          ? 'warn'
                          : 'bad'
                  }
                >
                  {stale
                    ? '状态过期'
                    : machine.ready
                      ? '采集就绪'
                      : machine.connected
                        ? '准备中'
                        : '未连接'}
                </Badge>
              </div>
            ))}
            {!machines.length && (
              <div className="empty">
                {observed
                  ? '暂无采集机组，请先添加连接配置。'
                  : '正在获取采集机组状态…'}
              </div>
            )}
          </section>
        </div>
        <div className="overview-column">
          <section className="panel">
            <div className="panel-heading">
              <h2>快捷入口</h2>
              <span className="subtle">常用操作</span>
            </div>
            <div className="quick-actions">
              {[
                [
                  'sliders',
                  '配置模拟方案',
                  '维护节点动态值与业务联动规则',
                  '#server/configuration',
                ],
                [
                  'activity',
                  '查看实时数据',
                  '筛选节点、查看数据质量与变化',
                  '#server/monitor',
                ],
                [
                  'network',
                  '管理采集连接',
                  '配置 OPC UA 设备与 Kafka 服务',
                  '#gateway/connections',
                ],
              ].map(([icon, title, description, href]) => (
                <a className="quick-action" href={href} key={href}>
                  <span className="quick-icon">
                    <Icon name={icon} size={19} />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <p>{description}</p>
                  </div>
                  <Icon name="arrowRight" size={15} />
                </a>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>运行关注</h2>
              <Badge kind={attention.length ? 'warn' : ''}>
                {attention.length ? `${attention.length} 项待关注` : '状态检查'}
              </Badge>
            </div>
            <div className="attention-list">
              {attention.length ? (
                attention.map((item) => (
                  <a
                    className="attention-item"
                    href={item.href}
                    key={item.title}
                  >
                    <Icon name="alert" size={16} />
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.text}</p>
                    </div>
                  </a>
                ))
              ) : (
                <div
                  className={`attention-item ${allHealthy ? 'is-good' : 'is-info'}`}
                >
                  <Icon name={allHealthy ? 'check' : 'info'} size={17} />
                  <div>
                    <strong>
                      {allHealthy
                        ? '当前没有待处理的连接异常'
                        : '正在确认运行状态'}
                    </strong>
                    <p>
                      {allHealthy
                        ? '系统将持续刷新设备、采集及投递状态。'
                        : '请等待数据更新，或前往网关运行总览查看详情。'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
          <details className="semantics-note">
            <summary>
              <Icon name="info" size={15} />
              数据策略 · 最新状态恢复
            </summary>
            <p>
              系统按窗口合并节点末值。故障后通过补全量快照恢复最新状态，不保留每次中间变化。模拟配置
              {server?.persistent ? '已持久化' : '保存方式待确认'}，
              {server?.simulationRunning
                ? '动态模拟正在运行'
                : '动态模拟未运行或待检测'}
              。
            </p>
          </details>
        </div>
      </div>
    </>
  );
}
