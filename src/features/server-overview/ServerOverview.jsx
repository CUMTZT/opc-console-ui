/**
 * 模拟服务总览的展示组件：快照由 Server 读取，本组件不保存另一份服务状态。
 * navigate 是父组件传入的回调；子组件只报告目标路径，不需要知道路由如何实现。
 */
import { Badge, number, time } from '../../shared.jsx';
import Icon from '../../components/Icon.jsx';

/**
 * snapshot 可为 null（尚未读取），因此服务信息使用可选链与占位符；nodes 总是数组。
 * navigate 来自 App，经 Server 传入，本组件调用它表达用户要去哪一个页面。
 * 无需在此 useEffect 请求数据，避免与父级重复轮询同一个目录。
 */
export default function ServerOverview({ snapshot, nodes, navigate }) {
  // 列表用稳定类型名作 key；progress 的 max 至少为 1，避免空目录时使用无效上限。
  return (
    <div className="server-overview-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              <Icon name="cpu" size={17} />
              服务信息
            </h2>
            <p>总览每 5 秒同步；数据监控每 1 秒刷新。</p>
          </div>
          <div className="actions">
            <button
              className="button"
              onClick={() => navigate('server/configuration')}
            >
              配置模拟
            </button>
            <button
              className="button primary"
              onClick={() => navigate('server/monitor')}
            >
              查看数据监控
            </button>
          </div>
        </div>
        <dl className="panel-content">
          {[
            ['OPC UA Endpoint', snapshot?.endpoint || '等待服务信息'],
            [
              '配置保存方式',
              snapshot
                ? snapshot.persistent
                  ? '状态文件持久化，重启后恢复管理变更'
                  : '内存模式，重启后管理变更失效'
                : '等待服务信息',
            ],
            ['最近同步', time(snapshot?.capturedAt)],
          ].map(([label, value]) => (
            <div className="detail-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            <Icon name="database" size={17} />
            节点类型分布
          </h2>
          <Badge>{number(nodes.length)} 个节点</Badge>
        </div>
        <div className="node-distribution panel-content">
          {/* 每种类型从同一 nodes 数组统计；这是渲染计算，不会更改节点类型或后端值。 */}
          {['FLOAT', 'LONG', 'BYTE', 'Bit'].map((type) => {
            const count = nodes.filter((node) => node.type === type).length;
            return (
              <div key={type}>
                <div className="section-title">
                  <span>{type}</span>
                  <strong>{snapshot ? number(count) : '—'}</strong>
                </div>
                <progress
                  aria-label={`${type} 节点占比`}
                  max={Math.max(1, nodes.length)}
                  value={count}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
