export function exponentialDelay(attempt: number, baseMs = 400, maxMs = 8000): number {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(cap * (0.75 + Math.random() * 0.5));
}

export function retryAfterMs(res: Response, attempt: number, baseMs = 400, maxMs = 8000): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maxMs, Math.max(200, seconds * 1000));
    const when = Date.parse(header);
    if (Number.isFinite(when)) return Math.min(maxMs, Math.max(200, when - Date.now()));
  }
  return exponentialDelay(attempt, baseMs, maxMs);
}

export function shouldRetryHttp(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithBackoff(
  input: string,
  init: RequestInit = {},
  opts: { retries?: number; baseMs?: number; maxMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10000;
  let last: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      last = await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!shouldRetryHttp(last.status) || attempt === retries) return last;
      await sleep(retryAfterMs(last, attempt, opts.baseMs, opts.maxMs));
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(exponentialDelay(attempt, opts.baseMs, opts.maxMs));
    }
  }
  return last as Response;
}
