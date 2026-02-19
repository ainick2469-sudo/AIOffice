const DEFAULT_TIMEOUT_MS = 8_000;

export class FetchWithTimeoutError extends Error {
  constructor(message, code, extras = {}) {
    super(message);
    this.name = 'FetchWithTimeoutError';
    this.code = code;
    if (Number.isFinite(extras.status)) {
      this.status = Math.trunc(extras.status);
    }
    if (extras.data !== undefined) {
      this.data = extras.data;
    }
    if (extras.cause !== undefined) {
      this.cause = extras.cause;
    }
  }
}

function parseResponseBody(response) {
  const contentType = String(response?.headers?.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => null);
}

export default async function fetchWithTimeout(input, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    ...fetchOptions
  } = options;

  const controller = new AbortController();
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.trunc(timeoutMs) : DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort('timeout'), duration);

  const abortFromCaller = () => controller.abort('external-abort');
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort('external-abort');
    } else {
      externalSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
  }

  try {
    const response = await fetch(input, {
      ...fetchOptions,
      signal: controller.signal,
    });
    const data = await parseResponseBody(response);

    if (!response.ok) {
      const message =
        (data && (data.detail || data.error || data.message))
        || `${response.status} ${response.statusText || 'Request failed'}`;
      throw new FetchWithTimeoutError(message, 'HTTP', {
        status: response.status,
        data,
      });
    }

    return {
      ok: true,
      status: response.status,
      data,
      response,
    };
  } catch (error) {
    if (error instanceof FetchWithTimeoutError) {
      throw error;
    }

    if (controller.signal.aborted) {
      const abortedByCaller = Boolean(externalSignal?.aborted);
      const code = abortedByCaller ? 'ABORT' : 'TIMEOUT';
      const message = abortedByCaller
        ? 'Request was cancelled.'
        : `Request timed out after ${duration}ms.`;
      throw new FetchWithTimeoutError(message, code, { cause: error });
    }

    throw new FetchWithTimeoutError(
      error?.message || 'Network request failed.',
      'NETWORK',
      { cause: error }
    );
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', abortFromCaller);
    }
  }
}
