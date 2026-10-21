export async function request(
  path,
  { method = 'GET', body, signal, timeout = 40000 } = {},
) {
  const cancellation = AbortSignal.any([
    AbortSignal.timeout(timeout),
    ...(signal ? [signal] : []),
  ]);
  const response = await fetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: cancellation,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  let result;
  try {
    result = response.status === 204 ? null : await response.json();
  } catch {
    cancellation.throwIfAborted();
    throw new Error(
      `服务或代理返回了非 JSON 响应（HTTP ${response.status}），请检查后端地址。`,
    );
  }
  cancellation.throwIfAborted();
  if (!response.ok) {
    const error = new Error(
      result?.error || result?.message || `请求失败（HTTP ${response.status}）`,
    );
    error.requestId = response.headers.get('X-Request-ID') || '';
    error.retryable =
      method === 'GET' && [429, 502, 503, 504].includes(response.status);
    error.status = response.status;
    error.data = result?.data;
    throw error;
  }
  if (result && typeof result === 'object')
    Object.defineProperty(result, 'requestId', {
      value: response.headers.get('X-Request-ID') || '',
      enumerable: false,
    });
  return result;
}
