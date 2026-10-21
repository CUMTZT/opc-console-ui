import { Alert, Badge, Field, Modal, time } from '../../shared.jsx';

export default function GatewayNodes({
  state,
  machine,
  setMachine,
  machines,
  readOnly,
}) {
  const s = state;
  const quality = (value) =>
    value >>> 30 === 0
      ? ['Good · 正常', 'good']
      : value >>> 30 === 1
        ? ['Uncertain · 不确定', 'warn']
        : ['Bad · 异常', 'bad'];
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>实时设备节点</h2>
          <small>自动刷新订阅缓存 · 设备直读单独执行</small>
        </div>
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
          <input
            type="search"
            aria-label="搜索设备节点"
            value={s.search}
            onChange={(e) => s.setSearch(e.target.value)}
            placeholder="搜索节点 ID 或名称"
          />
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
        <div className="panel-content">
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
        <div className="table-scroll">
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
