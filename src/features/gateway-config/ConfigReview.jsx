/**
 * 配置审阅：比较“文件 → 草稿”和“运行态 → 文件”，展示影响计划及历史版本入口。
 * 这里只计算和展示差异；载入/导出通过父级回调执行，避免审阅组件直接修改业务状态。
 */
import { Badge, time } from '../../shared.jsx';
import Icon from '../../components/Icon.jsx';

/**
 * before/after：两份纯 JSON 配置；path：递归累积的点分路径，最外层默认为空字符串。
 * 返回数组中的每一项代表叶子值变化，before/after 缺失时使用 undefined 表示增删。
 * 这是差异描述，不负责把差异应用回配置，也不修改传入对象。
 */
export function changes(before, after, path = '') {
  // 纯函数：同值返回空数组，对象递归到叶子，输出 {path, before, after} 列表。
  // 数组按索引比较，所以这里表达字段差异，不推断“机组移动”等更高层业务含义。
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    typeof before === 'object' &&
    typeof after === 'object'
  ) {
    // 合并双方键名并去重，确保新增和删除字段也能显示；flatMap 展开各层差异列表。
    return [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].flatMap((key) =>
      changes(before[key], after[key], path ? `${path}.${key}` : key),
    );
  }
  return [{ path, before, after }];
}
/** 差异值文本格式化：undefined 显示占位符“—”，对象/数组序列化为 JSON，其余转为字符串。 */
const display = (value) =>
  // 缺失值显示占位符，对象用 JSON 展示；保持 React 普通文本输出，不解析成 HTML。
  value === undefined
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
/**
 * draft/baseline/running：草稿、文件基线、当前运行配置，比较方向有意分开。
 * plan：后端对当前草稿的热应用评估；history：可载入的历史元信息，不是自动回滚指令。
 * onLoad/onExport：父级执行的业务动作；busy/error：禁用历史载入和展示读取失败。
 */
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
  // baseline 是上次读取的文件配置；running 尚未返回时不凭空宣称文件已经应用。
  const draftChanges = changes(baseline, draft),
    unapplied = running ? changes(running, baseline) : [];
  // 用原生 details 折叠次要信息；长差异只展示前 100 项，计数仍保留完整结果。
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
        {/* 展示草稿相对文件的修改，最多渲染一百项；摘要数量仍是完整差异总数。 */}
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
        {/* 已存文件也可能尚未应用，单独列出文件与运行态差异，不能与未保存修改混淆。 */}
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
          {/* 点击历史项只载入草稿，需要用户校验并保存后才可能切换运行配置。 */}
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
