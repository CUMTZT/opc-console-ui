/**
 * HTTP 请求边界：统一 JSON 编解码、超时/取消及错误信息，不包含业务页面状态。
 * 调用者只传同源 /api/server/* 或 /api/gateway/*；真实上游地址由代理配置决定。
 * 此函数不会自动重试；尤其设备写入超时时，必须先回读确认实际状态。
 */
/**
 * 参数 path：浏览器可访问的相对 API 路径，例如 /api/server/nodes。
 * 第二个参数使用对象解构与默认值，调用者可以只填写需要覆盖的 method/body/signal/timeout。
 * body 是普通 JavaScript 数据，本函数负责 JSON.stringify；不要预先把它转成 JSON 文本。
 * signal 来自页面/查询生命周期；timeout 的单位是毫秒，默认允许等待 40 秒。
 * 返回 Promise：成功得到解析后的响应对象（204 为 null），失败抛异常，由调用方 catch。
 */
export async function request(
  path,
  { method = 'GET', body, signal, timeout = 40000 } = {},
) {
  // 任一信号中止即停止等待：既支持请求超时，也支持切换页面/查询时主动取消。
  const cancellation = AbortSignal.any([
    // 超时信号到期会使 fetch 拒绝，通常表现为 TimeoutError；不是后端业务状态码。
    AbortSignal.timeout(timeout),
    // 数组展开把可选信号拼进去；未传 signal 时展开空数组，避免向 any 传 undefined。
    ...(signal ? [signal] : []),
  ]);
  const response = await fetch(path, {
    method,
    // undefined 表示不发送请求体；显式传 null 则会发送 JSON 的 null，两者含义不同。
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: cancellation,
    // 只有存在 JSON 请求体时才声明 Content-Type；浏览器页面不添加 Authorization。
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    // 不附带浏览器凭据，不跟随重定向，不复用 HTTP 缓存；当前管理 API 无需令牌。
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  let result;
  try {
    // 204 表示成功但没有响应体；其他状态先读 JSON，失败状态也可能携带业务错误。
    result = response.status === 204 ? null : await response.json();
  } catch {
    // 优先保留取消/超时原因，不把它错误地描述成 JSON 格式问题。
    cancellation.throwIfAborted();
    throw new Error(
      `服务或代理返回了非 JSON 响应（HTTP ${response.status}），请检查后端地址。`,
    );
  }
  // JSON 解析期间也可能被取消；落入业务成功/失败处理前再检查一次，拒绝已经过期的结果。
  cancellation.throwIfAborted();
  if (!response.ok) {
    // fetch 遇到 HTTP 409/500 不会自行抛错；这里统一转换为附带上下文的 Error。
    const error = new Error(
      result?.error || result?.message || `请求失败（HTTP ${response.status}）`,
    );
    error.requestId = response.headers.get('X-Request-ID') || '';
    // 这里只标记部分 GET 错误是否适合重试，不会触发重试，更不会重发写请求。
    error.retryable =
      method === 'GET' && [429, 502, 503, 504].includes(response.status);
    // status 供页面识别 409 冲突、404 不兼容等；data 可能含回滚结果或具体错误字段。
    error.status = response.status;
    error.data = result?.data;
    throw error;
  }
  // 请求编号可供排错读取，但不参与 JSON.stringify，避免污染草稿比较和接口数据。
  if (result && typeof result === 'object')
    Object.defineProperty(result, 'requestId', {
      value: response.headers.get('X-Request-ID') || '',
      // 不可枚举属性仍能用 result.requestId 读取，但对象展开和 JSON 序列化不会带走它。
      enumerable: false,
    });
  return result;
}
