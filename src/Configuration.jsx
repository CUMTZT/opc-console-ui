import { Field } from './shared.jsx';

const durations = [
  ['reconnect_interval', '重连间隔'],
  ['publishing_interval', '订阅发布间隔'],
  ['sampling_interval', '设备采样间隔'],
  ['drain_timeout', '首次快照前通知排空窗口'],
  ['shutdown_timeout', '进程退出超时'],
  ['aggregation_window', '增量聚合窗口'],
  ['operation_timeout', '设备操作超时'],
];
const counts = [
  ['queue_size', '订阅队列大小'],
  ['local_buffer_size', '本地通知缓冲上限'],
  ['send_queue_size', '待发批次上限'],
  ['max_nodes', '最大浏览节点数'],
];

export default function Configuration({
  config,
  setConfig,
  page,
  disabled,
  fieldError,
}) {
  function get(path) {
    return path.split('.').reduce((value, key) => value?.[key], config);
  }
  function set(path, value) {
    setConfig((current) => {
      const next = structuredClone(current),
        keys = path.split('.');
      let target = next;
      for (const key of keys.slice(0, -1)) target = target[key];
      target[keys.at(-1)] = value;
      return next;
    });
  }
  function field(path, label, options = {}) {
    const value = get(path),
      { choices, list, checkbox, numeric, hint, ...props } = options;
    if (checkbox)
      return (
        <label className="check" key={path}>
          <input
            data-config-path={path}
            aria-invalid={fieldError === path || undefined}
            type="checkbox"
            checked={value}
            onChange={(e) => set(path, e.target.checked)}
          />
          {label}
        </label>
      );
    return (
      <Field key={path} label={label} hint={hint}>
        {choices ? (
          <select
            data-config-path={path}
            aria-invalid={fieldError === path || undefined}
            value={value}
            onChange={(e) => set(path, e.target.value)}
          >
            {choices.map((choice) => (
              <option key={choice}>{choice}</option>
            ))}
          </select>
        ) : list ? (
          <textarea
            data-config-path={path}
            aria-invalid={fieldError === path || undefined}
            value={(value || []).join('\n')}
            onChange={(e) => set(path, e.target.value.split('\n'))}
            placeholder="每行一个服务器本地文件路径"
          />
        ) : (
          <input
            data-config-path={path}
            aria-invalid={fieldError === path || undefined}
            type={numeric ? 'number' : 'text'}
            step={numeric ? 1 : undefined}
            required={props.required !== false}
            value={value ?? ''}
            onChange={(e) =>
              set(
                path,
                numeric
                  ? e.target.value === ''
                    ? null
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
            {...props}
          />
        )}
      </Field>
    );
  }
  function addMachine() {
    const codes = new Set(config.opc.machines.map((machine) => machine.code));
    let n = config.opc.machines.length + 1;
    while (codes.has(`machine-${n}`)) n++;
    set('opc.machines', [
      ...config.opc.machines,
      {
        code: `machine-${n}`,
        server: 'opc.tcp://127.0.0.1:4840',
        topic: 'opc_data',
      },
    ]);
  }
  return (
    <fieldset disabled={disabled}>
      {page === 'connections' ? (
        <>
          <section className="panel">
            <div className="config-section">
              <h2>Kafka 连接</h2>
              <p>
                所有采集机组共用的发布器。地址为 Go 网关能够访问的 Broker 地址。
              </p>
              <div className="fields-grid">
                {field('kafka_producer.brokers', 'Bootstrap Servers', {
                  hint: '多个 Broker 用英文逗号分隔',
                })}
                {field('kafka_producer.delivery_timeout', '单次投递超时', {
                  hint: '支持 5s、500ms 等时长格式',
                })}
                {field('kafka_producer.retry_delay', '重试间隔')}
                {field('kafka_producer.max_retries', '最大重试次数', {
                  numeric: true,
                  min: 0,
                  max: 100,
                })}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="config-section">
              <div className="section-title">
                <div>
                  <h2>OPC UA 服务</h2>
                  <p>每个机组独立连接设备并转发到指定 Topic。</p>
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={config.opc.machines.length >= 256}
                  onClick={addMachine}
                >
                  ＋ 添加机组
                </button>
              </div>
              {config.opc.machines.map((machine, index) => (
                <article className="machine-config" key={index}>
                  <div className="machine-config-heading">
                    <strong>SERVER {String(index + 1).padStart(2, '0')}</strong>
                    <button
                      className="button small"
                      type="button"
                      aria-label={`删除机组 ${machine.code}`}
                      disabled={config.opc.machines.length <= 1}
                      onClick={() =>
                        set(
                          'opc.machines',
                          config.opc.machines.filter((_, i) => i !== index),
                        )
                      }
                    >
                      删除机组
                    </button>
                  </div>
                  <div className="fields-grid">
                    {field(`opc.machines.${index}.code`, '机组编码')}
                    {field(`opc.machines.${index}.server`, 'OPC UA Endpoint')}
                    {field(`opc.machines.${index}.topic`, 'Kafka Topic')}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="panel">
            <div className="config-section">
              <h2>基本设置</h2>
              <p>
                HTTP
                监听地址和端口需要编辑服务端配置文件并重启。日志设置由服务器保留。
              </p>
              <div className="fields-grid">
                {field('station_code', '站点编码')}
                {field('opc.http_bind_address', 'HTTP 监听地址', {
                  disabled: true,
                })}
                {field('opc.http_port', 'HTTP 管理端口', {
                  disabled: true,
                  numeric: true,
                })}
              </div>
            </div>
            <div className="config-section">
              <h2>采集与缓冲</h2>
              <p>时长使用 100ms、1s 等格式；最终范围由后端校验。</p>
              <div className="fields-grid">
                {durations.map(([key, label]) => field('opc.' + key, label))}
                {counts.map(([key, label]) =>
                  field('opc.' + key, label, { numeric: true, min: 1 }),
                )}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="config-section">
              <h2>OPC UA 安全设置</h2>
              <p>证书路径均指 Go 网关所在机器上的文件。</p>
              <div className="fields-grid">
                {field('opc.security.policy', '安全策略', {
                  choices: ['none', 'basic256_sha256'],
                })}
                {field('opc.security.mode', '消息安全模式', {
                  choices: ['none', 'sign', 'sign_and_encrypt'],
                })}
                {field('opc.security.certificate_file', '客户端证书路径', {
                  required: false,
                })}
                {field('opc.security.private_key_file', '客户端私钥路径', {
                  required: false,
                })}
                {field('opc.security.trust_list_files', '信任证书文件', {
                  list: true,
                })}
                {field('opc.security.revocation_list_files', '吊销列表文件', {
                  list: true,
                })}
              </div>
              <div className="fields-grid">
                {field('opc.allow_insecure_opcua', '允许不加密的 OPC UA 连接', {
                  checkbox: true,
                })}
              </div>
            </div>
          </section>
        </>
      )}
    </fieldset>
  );
}
