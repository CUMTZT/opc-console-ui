/**
 * 网关配置表单：只负责显示和修改草稿，读取/校验/保存 API 由父组件 Gateway 处理。
 * config 与 setConfig 来自 props；连接页与设置页编辑同一份父级草稿。
 * 通过字段路径生成受控控件，避免为大量配置项重复写 value/onChange。
 */
import { Field } from './shared.jsx';
import Icon from './components/Icon.jsx';

// 配置时长使用后端认可的字符串（如 250ms），计数项才转换成 JavaScript number。
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

/**
 * config：Gateway 拥有的当前草稿；setConfig：父级状态更新函数，支持 previous => next。
 * page：connections 显示连接配置，其余配置子页显示参数/安全设置，两者修改同一对象。
 * disabled：配置动作处理期间统一禁用字段；fieldError：后端报告的错误字段完整路径。
 * 本组件不保存另一份 config，也不调用保存接口，确保差异展示与表单使用相同数据。
 */
export default function Configuration({
  config,
  setConfig,
  page,
  disabled,
  fieldError,
}) {
  /** 按点分路径（如 opc.machines.0.code）从配置草稿中安全读取嵌套字段值。 */
  function get(path) {
    // 把 opc.machines.0.code 逐层取值；可选链支持字段暂缺时返回 undefined。
    return path.split('.').reduce((value, key) => value?.[key], config);
  }
  /** 按点分路径不可变地更新配置草稿：深拷贝当前草稿后定位到目标父对象并写入新值。 */
  function set(path, value) {
    setConfig((current) => {
      // 先深复制再沿路径赋值，既避免修改 props，也保持 React 的不可变更新约定。
      const next = structuredClone(current),
        keys = path.split('.');
      let target = next;
      // 先走到最后一个字段的父对象，最后一步才写入；当前契约要求中间结构已存在。
      for (const key of keys.slice(0, -1)) target = target[key];
      // 例如 opc.machines.0.topic：target 是第一个机组对象，最后的键是 topic。
      target[keys.at(-1)] = value;
      return next;
    });
  }
  /** 受控表单字段工厂：根据配置项类型生成复选框、下拉框、多行路径列表或文本/数字输入框，并绑定错误定位属性。 */
  function field(path, label, options = {}) {
    // 同一工厂根据选项返回 checkbox/select/textarea/input，路径也用于错误定位。
    const value = get(path),
      // 工厂专用选项先取出，剩余 min/max/required/disabled 等再传给原生 input。
      { choices, list, checkbox, numeric, hint, ...props } = options;
    // checkbox 使用 checked 布尔值，不读取 e.target.value（它通常是字符串 on）。
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
          // textarea 用多行文本展示路径数组；保存前由 Gateway 去掉空行，而非输入时强行删空行。
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
              // number 输入的 value 仍是文本；空值保留 null，以便 required 显示未填写。
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
  /** 在配置草稿末尾追加一台默认采集机组，自动避开已占用的 machine-N 编码。 */
  function addMachine() {
    // 从已有编码中找未被使用的默认编号；只更新本地草稿，保存前不会创建实际连接。
    const codes = new Set(config.opc.machines.map((machine) => machine.code));
    let n = config.opc.machines.length + 1;
    // 删除过机组后长度不能保证新编号唯一，因此持续检查已有编码再确定默认值。
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
  // fieldset 的 disabled 会统一禁用内部控件；所有非提交按钮都显式标注 type=button。
  // 这里机组行使用数组索引作 key；它不是稳定业务 ID，后续引入行内 state 时需留意。
  return (
    <fieldset disabled={disabled}>
      {/* 相同 form 下按路由选择字段组；切换只改变可见控件，草稿仍保存在父级。 */}
      {page === 'connections' ? (
        <>
          <section className="panel">
            <div className="config-section">
              <h2>
                <Icon name="send" size={17} />
                Kafka 连接
              </h2>
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
              {/* 这里用索引作 key，编辑编码时不会重挂载输入；若未来支持重排或行内状态应引入稳定 ID。 */}
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
              <h2>
                <Icon name="settings" size={17} />
                基本设置
              </h2>
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
              <h2>
                <Icon name="database" size={17} />
                采集与缓冲
              </h2>
              <p>时长使用 100ms、1s 等格式；最终范围由后端校验。</p>
              <div className="fields-grid">
                {/* 时长字段保留 Go 的单位字符串；计数项则通过 numeric 转为数字。 */}
                {durations.map(([key, label]) => field('opc.' + key, label))}
                {counts.map(([key, label]) =>
                  field('opc.' + key, label, { numeric: true, min: 1 }),
                )}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="config-section">
              <h2>
                <Icon name="settings" size={17} />
                OPC UA 安全设置
              </h2>
              <p>证书路径均指 Go 网关所在机器上的文件。</p>
              {/* 证书路径描述 Go 网关机器的文件，不是上传本机浏览器的证书。 */}
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
