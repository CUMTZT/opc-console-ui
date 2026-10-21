import { Badge, time } from '../../shared.jsx';
const stages = {
  connecting: '正在连接',
  browsing: '发现节点',
  subscribing: '建立订阅',
  draining: '排空旧通知',
  baselining: '建立快照',
  running: '运行中',
  ready: '采集就绪',
  failed: '失败',
};
export default function Diagnostics({ machines }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>运行诊断</h2>
        <small>采集、缓冲和投递状态分别展示</small>
      </div>
      <div className="panel-content">
        {!machines.length && <p>等待网关状态，暂无机组诊断数据。</p>}
        {machines.map((machine) => (
          <details key={machine.code} className="diagnostic-card">
            <summary>
              {machine.code}{' '}
              <Badge
                kind={
                  machine.ready ? 'good' : machine.connected ? 'warn' : 'bad'
                }
              >
                {stages[machine.stage] || machine.stage || '未连接'}
              </Badge>
            </summary>
            <dl>
              <dt>目录 / 会话代次</dt>
              <dd>
                {machine.generation}:{machine.sessionEpoch} ·{' '}
                {machine.nodeCount} 个节点
              </dd>
              <dt>最近发现</dt>
              <dd>{time(machine.lastBrowseTime)}</dd>
              <dt>最近确认</dt>
              <dd>{time(machine.lastAckTime)}</dd>
              <dt>队列</dt>
              <dd>
                {machine.queuedBatches || 0} 批次 / {machine.queuedBytes || 0}{' '}
                字节
              </dd>
              <dt>丢弃 / 溢出</dt>
              <dd>
                {machine.droppedBatches || 0} /{' '}
                {machine.notificationOverflows || 0}
              </dd>
              <dt>快照失败</dt>
              <dd>
                {machine.consecutiveSnapshotFailures || 0} 次 ·{' '}
                {machine.lastSnapshotError || '无'}
              </dd>
              <dt>最近管理排队</dt>
              <dd>{machine.lastCommandQueueWaitMs || 0} ms</dd>
              <dt>最近管理耗时</dt>
              <dd>{machine.lastCommandDurationMs || 0} ms</dd>
              <dt>最近错误</dt>
              <dd>{machine.lastError || '无'}</dd>
            </dl>
            <p>
              {!machine.connected
                ? '检查 OPC UA 地址、网络和安全策略。'
                : !machine.ready
                  ? '连接已建立，检查首个快照、Kafka 确认和容量错误。'
                  : machine.droppedBatches || machine.notificationOverflows
                    ? '发生过容量丢弃；结合队列和补快照记录确认恢复情况。'
                    : '当前采集已就绪。'}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
