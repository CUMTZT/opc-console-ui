import { Badge, time } from '../../shared.jsx';
import Icon from '../../components/Icon.jsx';

export function changes(before, after, path = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    typeof before === 'object' &&
    typeof after === 'object'
  ) {
    return [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].flatMap((key) =>
      changes(before[key], after[key], path ? `${path}.${key}` : key),
    );
  }
  return [{ path, before, after }];
}
const display = (value) =>
  value === undefined
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
export default function ConfigReview({
  draft,
  baseline,
  running,
  plan,
  history,
  onLoad,
  onExport,
  busy,
  error,
}) {
  const draftChanges = changes(baseline, draft),
    unapplied = running ? changes(running, baseline) : [];
  return (
    <details className="panel config-review">
      <summary>
        <h2>
          <Icon name="folder" size={17} />
          <span>配置差异与历史版本</span>{' '}
          <Badge kind={error ? 'bad' : draftChanges.length ? 'warn' : ''}>
            {error ? '读取失败' : `${draftChanges.length} 项变更`}
          </Badge>
        </h2>
        <span className="review-toggle">
          <span>查看详情</span>
          <Icon name="chevronDown" size={16} />
        </span>
      </summary>
      <div className="panel-content">
        <p>
          草稿对文件：{draftChanges.length} 项修改。文件对运行配置：
          {running ? `${unapplied.length} 项差异` : '尚未读取'}
          。历史版本仅恢复为草稿，仍需校验并保存。
        </p>
        {plan && (
          <p role="status">
            热应用计划：{plan.kafkaChanged ? '重建 Kafka 发布器；' : ''}新增{' '}
            {plan.addedMachines?.length || 0}、移除{' '}
            {plan.removedMachines?.length || 0}、重连{' '}
            {plan.restartedMachines?.length || 0} 个机组。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {draftChanges.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>字段</th>
                  <th>当前文件</th>
                  <th>编辑草稿</th>
                </tr>
              </thead>
              <tbody>
                {draftChanges.slice(0, 100).map((change) => (
                  <tr key={change.path}>
                    <td className="mono">{change.path}</td>
                    <td>{display(change.before)}</td>
                    <td>{display(change.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!draftChanges.length && <p>当前草稿与文件内容一致。</p>}
        {unapplied.length > 0 && (
          <details>
            <summary>查看文件尚未应用的差异</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>正在运行</th>
                    <th>文件配置</th>
                  </tr>
                </thead>
                <tbody>
                  {unapplied.slice(0, 100).map((change) => (
                    <tr key={change.path}>
                      <td>{change.path}</td>
                      <td>{display(change.before)}</td>
                      <td>{display(change.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        <h3>
          历史版本 <Badge>{history?.length || 0}</Badge>
        </h3>
        <p>后端保留最近 20 次保存前的配置。日志设置由当前服务器保留。</p>
        <div className="actions">
          {history?.map((entry) => (
            <button
              type="button"
              className="button small"
              disabled={busy}
              key={entry.id}
              onClick={() => onLoad(entry.id)}
            >
              {time(entry.createdAt)} · {entry.stationCode} · 载入草稿
            </button>
          ))}
        </div>
        <div className="form-actions">
          <button type="button" className="button" onClick={onExport}>
            <Icon name="download" size={14} />
            导出当前草稿
          </button>
        </div>
      </div>
    </details>
  );
}
