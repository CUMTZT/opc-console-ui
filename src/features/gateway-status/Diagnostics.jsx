/**
 * 网关诊断展示：把后端机组阶段码映射成中文，同时展示会话代次、队列和错误指标。
 * connected 只代表连接建立，ready 还要求完成采集准备和快照确认，两者不可混用。
 */
import { Badge, time } from '../../shared.jsx';
import Icon from '../../components/Icon.jsx';
// 后端阶段码保持英文协议值；中文只用于界面展示，未知新阶段仍回退显示原值。
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
/**
 * machines 是 Gateway 最近读取的运行状态数组；这里不复制、不修改，也不独立发请求。
 * generation/sessionEpoch 用于识别目录与会话代次，便于解释重新发现/重连后的状态。
 * 下面的 || 0/|| '无' 提供缺省显示，不代表服务器实际执行了计数器重置。
 */
export default function Diagnostics({ machines }) {
  // 每个机组使用独立 details，无需额外 state 也能由浏览器提供键盘可用的展开行为。
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          <Icon name="activity" size={17} />
          运行诊断
        </h2>
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
            {/* 建议按连接→就绪→容量告警的顺序给出；历史溢出计数不等于当前连接已断开。 */}
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
