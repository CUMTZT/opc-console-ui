import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import Icon from './components/Icon.jsx';

export { request } from './api/client.js';

// A request must finish before the next poll starts. Cleanup aborts old sessions and pages.
export function usePolling(task, delay, enabled, key = '') {
  const callback = useRef(task);
  callback.current = task;
  const [nonce, setNonce] = useState(0);
  const lastManual = useRef(0);
  useEffect(() => {
    const manual = nonce !== lastManual.current;
    lastManual.current = nonce;
    if (!enabled && !manual) return;
    const controller = new AbortController();
    let timer;
    async function run() {
      try {
        await callback.current(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) console.error(error);
      }
      if (!controller.signal.aborted && enabled) timer = setTimeout(run, delay);
    }
    run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [delay, enabled, key, nonce]);
  return () => setNonce((n) => n + 1);
}
export function useVisible() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const listener = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);
  return visible;
}
export function useClock(enabled = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}
export function isCancelled(error) {
  return error?.name === 'AbortError';
}
export function errorText(error) {
  return error?.name === 'TimeoutError'
    ? '请求超时，操作结果尚未确认，请重新读取状态后再决定是否重试。'
    : (error?.message || '操作失败') +
        (error?.requestId ? `（请求编号：${error.requestId}）` : '');
}
export const number = (value) => Number(value || 0).toLocaleString('zh-CN');
export const time = (value) =>
  value &&
  !String(value).startsWith('0001-') &&
  !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '—';
export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Alert({ children, kind = 'danger' }) {
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
export function Badge({ children, kind = '' }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
export function Modal({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
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
export function Field({ label, children, hint }) {
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
export function Metric({ label, value, hint, icon, kind = '' }) {
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
