/**
 * 共享基础层：页面可见性、串行轮询、时间，以及表单、提示、弹窗等复用组件。
 * use 开头的函数是自定义 Hook：复用有状态逻辑，每次调用仍拥有独立的状态。
 * 普通格式化函数不需要 Hook；纯展示组件通过 props 接收内容，通过 children 组合界面。
 */
import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import Icon from './components/Icon.jsx';

// 转导出维持页面的统一导入入口：页面从 shared.jsx 导入 request，实际实现在 api/client.js。
export { request } from './api/client.js';

/**
 * 串行轮询：task(signal) 完成后等待 delay 毫秒，再开始下一轮，避免慢请求堆积。
 * enabled 控制自动轮询，key 标识机组/筛选/分页等查询条件，返回值用于手动刷新。
 * 依赖变化或卸载时取消当前请求并清除定时器；task 还需把 signal 传给 request。
 * 页面可见性由调用者组合 useVisible 传入，本 Hook 自身不会读取 document.hidden。
 */
export function usePolling(task, delay, enabled, key = '') {
  // ref 跨渲染保存最新任务，修改 current 不触发渲染，也不因函数引用变化而重启轮询。
  const callback = useRef(task);
  callback.current = task;
  // nonce 不是时间戳，而是手动刷新的递增编号；只有 setter 才会让 React 重新运行组件。
  const [nonce, setNonce] = useState(0);
  // 保存上一轮已经处理的编号；与 nonce 比较，区分“自动条件变化”和“用户点击刷新”。
  const lastManual = useRef(0);
  useEffect(() => {
    // 手动刷新通过递增 nonce 唤起 Effect；即使暂停自动刷新，也允许执行一次。
    const manual = nonce !== lastManual.current;
    // 在决定是否启动前记住本次编号，避免后续无关依赖变化被误判为又一次手动刷新。
    lastManual.current = nonce;
    // 自动已暂停且用户没有主动请求时，连首次 run 也不执行；不只是停止下一轮定时器。
    if (!enabled && !manual) return;
    // 每一轮 Effect 拥有独立控制器；依赖改变后旧信号永久中止，新 Effect 创建新的信号。
    const controller = new AbortController();
    // 定时器句柄属于当前 Effect 的闭包，不需要显示在 UI，也无需存入 useState。
    let timer;
    // async 函数内部 await 任务完成，既支持请求成功，也能等待任务自己的异常处理完成。
    async function run() {
      try {
        // 读取 ref 中最新函数，拿到最新页面状态；仍传入本轮 signal 约束这次任务的寿命。
        await callback.current(controller.signal);
      } catch (error) {
        // 正常的页面切换取消不记错误；未被业务组件处理的异常才输出到浏览器控制台。
        if (!controller.signal.aborted) console.error(error);
      }
      // 网络轮询只在 await 完成后安排下一轮，实际间隔还包含请求耗时。
      if (!controller.signal.aborted && enabled) timer = setTimeout(run, delay);
    }
    // 初始化立即读取一次，用户不用先等完整 delay；后续执行才由 setTimeout 安排。
    run();
    return () => {
      // abort 中止 fetch 等等待；它不能回滚后端已经执行的动作。
      controller.abort();
      // 如果请求已经结束并安排了下一轮，这里同时取消那一轮，防止隐藏页面继续请求。
      clearTimeout(timer);
    };
    // 任一依赖变化：清理旧轮询，再按最新参数启动。task 引用由上面的 ref 单独保存。
    // key 应包含机组/搜索/分页等影响响应含义的条件，否则可能继续使用旧查询会话。
  }, [delay, enabled, key, nonce]);
  // 函数式更新从最新状态计算下一个值，连续点击时不会依赖旧闭包中的 nonce。
  return () => setNonce((n) => n + 1);
}
/** 监听浏览器标签页可见性（document.hidden），供轮询在后台标签页自动暂停。 */
export function useVisible() {
  // document.hidden 是浏览器标签页可见性；业务页面是否选中由另外的 active 表示。
  // 初值立即反映当前浏览器标签页；visible 不表示组件是否被父级 hidden 属性隐藏。
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    // visibilitychange 事件本身不携带新布尔值，需要重新读取 document.hidden。
    const listener = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);
  return visible;
}
/** 秒级本地时钟 Hook：启用时每秒更新一次毫秒时间戳，供顶栏时钟、运行时长与变化高亮共用。 */
export function useClock(enabled = true) {
  // 这里只更新本地时间，没有异步网络请求，因此可以使用 setInterval。
  // 毫秒时间戳用于页面计算持续时间和变化高亮；格式化留给实际展示它的组件。
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    // 从停用恢复时先校准一次，不必等待下一秒；否则可能短暂显示暂停前的时间。
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}
/** 判断是否为主动取消；调用方通常忽略这种异常，保留正常切页体验。 */
export function isCancelled(error) {
  // 主动取消是正常流程；超时 TimeoutError 应继续提示用户，不能当作取消吞掉。
  return error?.name === 'AbortError';
}
/** 将底层异常转为 UI 文案；不改变异常对象，不决定是否重试，由业务事件处理器使用。 */
export function errorText(error) {
  // 请求编号来自后端响应头，便于把 UI 中的失败与服务端日志对应起来。
  return error?.name === 'TimeoutError'
    ? '请求超时，操作结果尚未确认，请重新读取状态后再决定是否重试。'
    : (error?.message || '操作失败') +
        (error?.requestId ? `（请求编号：${error.requestId}）` : '');
}
/** 数字格式化工具：空值按 0 处理，再按中文区域规则插入千位分隔符，返回展示字符串。 */
export const number = (value) => Number(value || 0).toLocaleString('zh-CN');
/** 时间格式化工具：Go 零时间（0001- 开头）与无效/空时间统一显示占位符“—”。 */
export const time = (value) =>
  value &&
  !String(value).startsWith('0001-') &&
  !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '—';
/** 浏览器端文件导出工具：将内存文本或 JSON/CSV 内容包装为 Blob 并触发本地文件下载。 */
export function download(name, data, type) {
  // Blob 保存内存数据，对象 URL 供下载链接使用；稍后释放 URL，避免一直占用内存。
  const url = URL.createObjectURL(new Blob([data], { type }));
  // 这是下载用途的临时 DOM 操作；普通业务 UI 仍交给 React，避免手工更改组件内部 DOM。
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // 留出浏览器开始读取的时间后释放对象 URL；不是向服务器上传或删除任何文件。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/**
 * children：任意可渲染的提示内容，可包括文字和操作按钮。
 * kind：danger（默认错误）、success（成功）、info（说明），同时决定样式与语义角色。
 * 判断使用 JavaScript 真值规则：空字符串/null/undefined 等直接返回 null。
 */
export function Alert({ children, kind = 'danger' }) {
  // children 是组件标签之间的内容；没有内容时返回 null，React 不创建可见元素。
  // 错误用 role=alert，普通结果用 role=status，帮助读屏软件识别提示的重要程度。
  return children ? (
    <div
      className={`alert ${kind}`}
      role={kind === 'danger' ? 'alert' : 'status'}
    >
      <Icon
        name={
          kind === 'danger' ? 'alert' : kind === 'success' ? 'check' : 'info'
        }
        size={17}
      />
      <div className="alert-content">{children}</div>
    </div>
  ) : null;
}
/** 紧凑状态标签。默认 kind 为空时采用中性样式；本身不发请求或判断连接状态。 */
export function Badge({ children, kind = '' }) {
  // kind 对应 CSS 的 good/warn/bad 等类名，业务页面决定实际语义。
  return <span className={`badge ${kind}`}>{children}</span>;
}
/**
 * title：弹窗可见标题与可访问名称；children：由调用方插入的表单或详情。
 * onClose：通知父级改变“是否渲染弹窗”的状态；不是直接删除 DOM。
 * busy：正在执行操作时禁用关闭。组件挂载时打开 dialog，卸载时关闭 dialog。
 * ref 用来访问浏览器原生方法，表单内容本身仍通过 props/state 声明式渲染。
 */
export function Modal({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  useEffect(() => {
    // 原生 dialog 的 showModal 是命令式 DOM API，需在 DOM 挂载后的 Effect 中调用。
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  // Escape 会触发 cancel；busy 期间阻止关闭，避免操作尚在进行时丢失结果提示。
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        // 阻止原生 Escape 自动关 dialog，统一经由 onClose 让 React 状态与 DOM 保持同步。
        event.preventDefault();
        if (!busy) onClose?.();
      }}
      aria-label={title}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        {onClose && (
          <button
            type="button"
            className="button"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            关闭 ×
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
/**
 * 表单外壳：label 是名称，hint 是可选帮助内容，children 必须是一个可克隆的表单元素。
 * 父级 input/select/textarea 的 value/onChange 会保留，只补 ID 和提示文字关联。
 * 若子控件已有 ID 就沿用；否则使用 useId，以便多个 Field 同时出现时不发生 ID 重复。
 */
export function Field({ label, children, hint }) {
  // 每个 Field 接收一个表单元素；useId 生成稳定 ID，cloneElement 补齐可访问性属性。
  // htmlFor 关联输入框，aria-describedby 关联帮助文案，点击标签即可聚焦控件。
  const id = useId(),
    controlId = children.props.id || id;
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {cloneElement(children, {
        id: controlId,
        ...(hint ? { 'aria-describedby': id + '-hint' } : {}),
      })}
      {hint && <small id={id + '-hint'}>{hint}</small>}
    </div>
  );
}
/**
 * 指标卡片：label 描述“是什么”，value 是当前值，hint 补充口径/同步时间。
 * icon 可省略；kind 只控制视觉强调。使用同一展示结构保证不同页面指标风格一致。
 */
export function Metric({ label, value, hint, icon, kind = '' }) {
  // 展示组件无需保存父级数据的副本；props 变化时直接渲染新的指标即可。
  return (
    <article className={`metric ${kind ? `metric-${kind}` : ''}`}>
      <div className="metric-heading">
        <span>{label}</span>
        {icon && (
          <span className="metric-icon">
            <Icon name={icon} size={19} />
          </span>
        )}
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}
