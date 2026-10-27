/**
 * 节点展示层：state 来自 useGatewayNodes，机组选择来自父组件 Gateway。
 * 本组件不发网络请求，按钮只调用 Hook 提供的事件函数；便于把界面与业务流程分开读。
 * 注意 s.page 是分页响应，和 Gateway 的 page（路由子页面名）含义不同。
 */
import { Alert, Badge, Field, Modal, time } from '../../shared.jsx';
import Icon from '../../components/Icon.jsx';

/**
 * state：Hook 返回的状态/动作对象，下文简写 s；组件不复制它，以免 UI 与业务状态分离。
 * machine/setMachine：父级当前机组与更新函数；machines：实际运行机组列表。
 * readOnly：网关只读提示标志；真正的禁写条件还包含 s.canWrite 的新鲜度等检查。
 * 子组件通过事件回调表达用户意图，网络时序与写入状态转换交给 Hook 统一处理。
 */
export default function GatewayNodes({
  state,
  machine,
  setMachine,
  machines,
  readOnly,
}) {
  const s = state;
  // 后端 quality 是整数状态码，最高两位决定 Good/Uncertain/Bad，不能直接当布尔值。
  const quality = (value) =>
    value >>> 30 === 0
      ? ['Good · 正常', 'good']
      : value >>> 30 === 1
        ? ['Uncertain · 不确定', 'warn']
        : ['Bad · 异常', 'bad'];
  // 禁用控件是业务状态的可视化：只读、过期和待回读时都不能启动新的设备写入。
  // unknown 分支只有“重新回读确认”，调用 verify 而不是 write，不会重复发送指令。
  // 行 key 使用 node.code；操作记录只是本次浏览会话，浏览器刷新后会丢失。
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            <Icon name="database" size={17} />
            实时设备节点
          </h2>
          <small>自动刷新订阅缓存 · 设备直读单独执行</small>
        </div>
        {/* 工具栏区分缓存刷新、设备直读和目录重发现，三个按钮会执行不同后端行为。 */}
        <div className="toolbar">
          <select
            aria-label="选择机组"
            value={machine}
            disabled={s.busy}
            onChange={(e) => {
              setMachine(e.target.value);
              s.setOffset(0);
            }}
          >
            <option value="">请选择机组</option>
            {machines.map((m) => (
              <option key={m.code}>{m.code}</option>
            ))}
          </select>
          <div className="search-field">
            <Icon name="search" size={16} />
            <input
              type="search"
              aria-label="搜索设备节点"
              value={s.search}
              onChange={(e) => s.setSearch(e.target.value)}
              placeholder="搜索节点 ID 或名称"
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={s.auto}
              onChange={(e) => s.setAuto(e.target.checked)}
            />
            自动刷新
          </label>
          <button
            className="button"
            disabled={!machine || s.busy}
            onClick={s.refreshCache}
          >
            <Icon name="refresh" size={13} />
            刷新节点
          </button>
          <button
            className="button"
            disabled={!machine || s.busy}
            onClick={s.readDevice}
          >
            {s.directBusy ? '正在读取…' : '立即读取设备'}
          </button>
          <button
            className="button"
            disabled={!machine || s.busy || !!s.verification}
            onClick={s.rediscover}
          >
            重新发现节点
          </button>
        </div>
        {/* 上下文说明数据来源与新鲜度；设备值不变不代表通信没有发生。 */}
        <div className="node-context">
          <Alert>{s.error}</Alert>
          {readOnly && (
            <Alert kind="info">当前网关为设备只读模式，禁止写入。</Alert>
          )}
          {s.page && (
            <p>
              {s.viewStale
                ? '离线 / 数据过期'
                : s.page.cached
                  ? '订阅缓存'
                  : '设备直读'}{' '}
              · 缓存生成 {time(s.page.capturedAt)} · 最近设备读取{' '}
              {time(s.page.readAt)} · 目录版本 {s.page.catalogRevision || '—'}
              {!s.auto ? ' · 已暂停自动刷新' : ''}
            </p>
          )}
          {s.scan && (
            <Alert kind={s.scan.state === 'failed' ? 'danger' : 'info'}>
              {s.scan.state === 'starting'
                ? '正在停止旧会话并等待消息确认…'
                : s.scan.state === 'browsing'
                  ? '正在重新发现节点…'
                  : s.scan.state === 'failed'
                    ? s.scan.message
                    : `目录已更新：${s.scan.count} 个节点；${s.scan.state === 'ready' ? '新快照已确认' : '等待新快照确认'}`}
            </Alert>
          )}
          {/* 弹窗关闭后依旧显示待确认目标，按钮只调用 GET 回读，不能重新提交那次写入。 */}
          {s.verification && !s.target && (
            <Alert>
              上一笔写入仍需回读确认：{s.verification.machine} /{' '}
              {s.verification.code}。
              <button
                className="button"
                disabled={s.busy}
                onClick={() => s.verify(s.verification)}
              >
                重新回读确认
              </button>
              {s.writeError}
            </Alert>
          )}
        </div>
        <div
          className="table-scroll data-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="采集设备节点数据表"
        >
          <table>
            <thead>
              <tr>
                <th>节点 ID / 名称</th>
                <th>类型</th>
                <th>当前值</th>
                <th>质量</th>
                <th>源时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {/* 可选链允许首个响应尚未到达；质量码转成标签与十六进制文本供用户同时判断。 */}
              {s.page?.nodes.map((node) => {
                const [label, kind] = quality(node.quality);
                return (
                  <tr key={node.code}>
                    <td>
                      <strong>{node.name}</strong>
                      <small className="mono">{node.code}</small>
                    </td>
                    <td>{node.type}</td>
                    <td className="value">
                      {node.value}
                      {(node.stale || s.viewStale) && <small>待重新读取</small>}
                    </td>
                    <td>
                      <Badge kind={kind}>{label}</Badge>
                      <small className="mono">
                        0x{(node.quality >>> 0).toString(16).padStart(8, '0')}
                      </small>
                    </td>
                    <td>
                      {time(node.sourceTime)}
                      <small>最近观测 {time(node.observedAt)}</small>
                    </td>
                    <td>
                      <button
                        className="button small"
                        disabled={!s.canWrite || node.stale || !!s.target}
                        onClick={() => s.openWrite(node)}
                      >
                        写入
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!s.page?.nodes.length && (
            <div className="empty">
              {!machine
                ? '选择机组后读取节点'
                : s.error
                  ? '节点读取失败'
                  : s.page
                    ? '没有匹配节点'
                    : '正在读取节点…'}
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            共 {s.page?.total ?? '—'} 个节点 · 目录更新{' '}
            {time(s.page?.catalogAt)}
          </span>
          <div className="actions">
            <button
              className="button small"
              disabled={!s.offset || s.busy}
              onClick={() => s.setOffset(Math.max(0, s.offset - 25))}
            >
              上一页
            </button>
            <button
              className="button small"
              disabled={!s.page || s.offset + 25 >= s.page.total || s.busy}
              onClick={() => s.setOffset(s.offset + 25)}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
      {/* 内存操作记录用于本会话排错；operationId/requestId 可关联后端日志，但不是完整审计库。 */}
      {s.operations.length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <h2>当前会话操作记录</h2>
            <small>最近 20 次 · 仅保存在页面内存</small>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作</th>
                  <th>对象</th>
                  <th>结果</th>
                  <th>请求编号</th>
                </tr>
              </thead>
              <tbody>
                {s.operations.map((op, index) => (
                  <tr key={op.at + index}>
                    <td>{time(op.at)}</td>
                    <td>{op.kind}</td>
                    <td>
                      {op.machine} / {op.code}
                    </td>
                    <td>
                      {op.state === 'confirmed'
                        ? '已回读'
                        : op.state === 'unknown'
                          ? '待确认'
                          : op.state === 'observed'
                            ? '已读取当前值（原写入未知）'
                            : '已接受'}
                    </td>
                    <td className="mono">
                      {op.operationId || op.requestId || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {/* 弹窗内容固定使用 target 的机组和写前值，不会随表格轮询悄悄换掉用户确认的对象。 */}
      {s.target && (
        <Modal title="写入设备节点" busy={s.busy} onClose={s.closeWrite}>
          <form onSubmit={s.write}>
            <p>写入结果与当前设备值分别显示，设备联动可能继续改变数值。</p>
            <dl>
              <dt>机组</dt>
              <dd>{s.target.machine}</dd>
              <dt>Node ID</dt>
              <dd>{s.target.code}</dd>
              <dt>类型</dt>
              <dd>{s.target.type}</dd>
              <dt>写前值</dt>
              <dd>{s.target.value}</dd>
            </dl>
            {/* 只允许 idle 编辑请求值；提交后锁住它，避免实际发送内容与展示内容不一致。 */}
            <Field label="写入值">
              <input
                value={s.value}
                disabled={s.phase !== 'idle' || s.busy}
                onChange={(e) => s.setValue(e.target.value)}
              />
            </Field>
            <Alert>{s.writeError}</Alert>
            {s.phase === 'writing' && <Alert kind="info">正在写入设备…</Alert>}
            {s.phase === 'reading' && (
              <Alert kind="info">写入已接受，正在回读当前值…</Alert>
            )}
            {s.readback && (
              <Alert kind="success">
                已回读当前值：{s.readback.value}
                {!s.readback.writeAccepted ? '（原写入结果仍未知）' : ''} ·{' '}
                {time(s.readback.observedAt)}
              </Alert>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button"
                disabled={s.busy}
                onClick={s.closeWrite}
              >
                {s.phase === 'confirmed' ? '完成' : '取消'}
              </button>
              {/* unknown 使用普通按钮执行 verify；其余分支 submit 也受 phase/canWrite 双重限制。 */}
              {s.phase === 'unknown' ? (
                <button
                  type="button"
                  className="button primary"
                  disabled={s.busy}
                  onClick={() => s.verify(s.verification)}
                >
                  重新回读确认
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={s.busy || s.phase !== 'idle' || !s.canWrite}
                >
                  {s.phase === 'reading'
                    ? '正在回读…'
                    : s.phase === 'writing'
                      ? '正在写入…'
                      : s.phase === 'confirmed'
                        ? '已回读确认'
                        : '确认写入'}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
