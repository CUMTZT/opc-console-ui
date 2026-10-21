import { useState } from 'react';
import {
  Alert,
  Badge,
  Metric,
  errorText,
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
  const machines = gateway?.machines || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SYSTEM OVERVIEW</div>
          <h1>系统总览</h1>
          <p>分别确认服务可达、设备连接、采集就绪与 Kafka 投递。</p>
        </div>
      </div>
      <Alert>{error}</Alert>
      {gateway?.stale && (
        <Alert>
          网关状态已过期：{gateway.error}。以下保留最近一次成功状态。
        </Alert>
      )}
      <section className="metrics">
        <Metric
          label="模拟服务"
          value={
            error
              ? '连接失败'
              : server?.state === 'running'
                ? '运行中'
                : '待检测'
          }
          hint={`${server?.nodeCount ?? '—'} 个模拟节点`}
        />
        <Metric
          label="OPC UA 连接"
          value={
            gateway
              ? `${machines.filter((m) => m.connected).length} / ${machines.length}`
              : '待检测'
          }
          hint="连接不代表首个快照已经确认"
        />
        <Metric
          label="采集就绪"
          value={
            gateway
              ? `${machines.filter((m) => m.ready).length} / ${machines.length}`
              : '—'
          }
          hint="以当前代次的快照确认为准"
        />
        <Metric
          label="Kafka 协议探测"
          value={
            gateway?.kafkaConnection?.state === 'connected'
              ? '可响应'
              : gateway
                ? '异常 / 未确认'
                : '—'
          }
          hint={`最近探测 ${time(gateway?.kafkaConnection?.checkedAt)}`}
        />
      </section>
      {!gateway && (
        <Alert kind="info">
          正在自动连接采集网关，可前往<a href="#gateway/overview">运行总览</a>
          查看详情。
        </Alert>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>数据与运行边界</h2>
          <Badge>最新状态恢复</Badge>
        </div>
        <div className="panel-content">
          <p>
            系统按窗口合并节点末值。发生丢弃后通过补全量快照恢复最新状态，不承诺每次中间变化完整留存。
          </p>
          <p>
            模拟服务：
            {server?.simulationRunning
              ? '模拟启用'
              : '模拟未运行 / 待检测'} ·{' '}
            {server?.persistent ? '配置持久化' : '内存模式 / 待检测'}
          </p>
          <p>
            网关状态同步：{time(gateway?.serverTime)} · 投递结果未知{' '}
            {gateway?.kafka?.unknownBatches ?? '—'} 批次
          </p>
        </div>
      </section>
    </>
  );
}
