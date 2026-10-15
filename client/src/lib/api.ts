export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR', public details?: unknown) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function request<T>(method: string, url: string, body?: Body): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'yash-pos' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check the internet connection.', 'NETWORK');
  }
  if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('yash:unauthenticated'));
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const e = (data as { error?: { message?: string; code?: string; details?: unknown } })?.error;
    throw new ApiError(res.status, e?.message ?? `Request failed (${res.status})`, e?.code, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: Body) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: Body) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: Body) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const qs = (o: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Field-level messages from a 422 validation error. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION') return {};
  const d = e.details as { fieldErrors?: Record<string, string[]> } | undefined;
  return Object.fromEntries(Object.entries(d?.fieldErrors ?? {}).map(([k, v]) => [k, v[0]]));
}

export const errorText = (e: unknown) => {
  if (e instanceof ApiError && e.code === 'VALIDATION') {
    const d = e.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
    const first = [...(d?.formErrors ?? []), ...Object.entries(d?.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v[0]}`)][0];
    return first ? `Please check the form - ${first}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
};
