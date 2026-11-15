// Một chỗ duy nhất gọi máy chủ. Mọi màn hình dùng `api.get/post/put/del` (hoặc các hàm trong
// src/api/*.ts được dựng trên chúng) — không gọi fetch trực tiếp ở nơi khác.

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'LOSS_WARNING'
  | 'IN_USE'
  | 'INSUFFICIENT_STOCK'
  | 'FEATURE_OFF'
  | 'PERIOD_LOCKED'
  | 'IMPORT_INVALID'
  | 'INTERNAL'
  | 'NETWORK'
  | 'UNKNOWN';

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'VALIDATION',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'LOSS_WARNING',
  'IN_USE',
  'INSUFFICIENT_STOCK',
  'FEATURE_OFF',
  'PERIOD_LOCKED',
  'IMPORT_INVALID',
  'INTERNAL',
]);

/** Câu thông báo dự phòng khi máy chủ không gửi `message` (không bao giờ hiện mã lỗi thô). */
const FALLBACK_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION: 'Dữ liệu nhập chưa đúng, vui lòng kiểm tra lại.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này. Hãy nhờ người quản trị.',
  NOT_FOUND: 'Không tìm thấy dữ liệu. Có thể máy khác vừa xóa — hãy tải lại trang.',
  VERSION_CONFLICT: 'Máy khác vừa sửa dữ liệu này. Hãy tải lại rồi sửa tiếp.',
  LOSS_WARNING: 'Có dòng bán thấp hơn giá mua.',
  IN_USE: 'Dữ liệu đã được sử dụng, không xóa được.',
  INSUFFICIENT_STOCK: 'Không đủ hàng trong kho.',
  FEATURE_OFF: 'Tính năng này chưa được bật (Danh mục › Tính năng mở rộng).',
  PERIOD_LOCKED: 'Kỳ này đã khóa sổ, không sửa được.',
  IMPORT_INVALID: 'File còn lỗi, chưa nhập dòng nào.',
  INTERNAL: 'Máy chủ gặp lỗi. Vui lòng thử lại; nếu vẫn lỗi hãy báo người quản trị.',
  NETWORK: 'Không kết nối được máy chủ. Kiểm tra mạng (hoặc máy chủ đã bật chưa) rồi thử lại.',
  UNKNOWN: 'Có lỗi xảy ra. Vui lòng thử lại.',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Tên trường bị lỗi (`details.field`) nếu máy chủ chỉ ra. */
  get field(): string | undefined {
    const d = this.details;
    if (d && typeof d === 'object' && !Array.isArray(d) && 'field' in d) {
      const f = (d as { field?: unknown }).field;
      return typeof f === 'string' ? f : undefined;
    }
    return undefined;
  }

  /** Số dòng bị lỗi (`details.line_no`) nếu có. */
  get lineNo(): number | undefined {
    const d = this.details;
    if (d && typeof d === 'object' && !Array.isArray(d) && 'line_no' in d) {
      const n = (d as { line_no?: unknown }).line_no;
      return typeof n === 'number' ? n : undefined;
    }
    return undefined;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Câu thông báo tiếng Việt cho mọi loại lỗi (dùng ở message/notification). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return FALLBACK_MESSAGE.UNKNOWN;
}

type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

let unauthorizedHandler: (() => void) | null = null;
/** AuthProvider đăng ký: gặp 401 ở bất kỳ đâu ⇒ quay về màn đăng nhập. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function buildUrl(path: string, query?: QueryParams): string {
  const url = `/api${path}`;
  if (!query) return url;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${url}?${s}` : url;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: ErrorBody | null = null;
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    body = null;
  }
  const rawCode = body?.error?.code;
  let code: ErrorCode;
  if (typeof rawCode === 'string' && KNOWN_CODES.has(rawCode)) code = rawCode as ErrorCode;
  else if (res.status === 401) code = 'UNAUTHORIZED';
  else if (res.status === 403) code = 'FORBIDDEN';
  else if (res.status === 404) code = 'NOT_FOUND';
  else if (res.status === 502 || res.status === 503 || res.status === 504) code = 'NETWORK';
  else if (res.status >= 500 && body === null) code = 'NETWORK'; // không phải JSON của máy chủ ⇒ lỗi đường truyền/proxy
  else if (res.status >= 500) code = 'INTERNAL';
  else code = 'UNKNOWN';
  const rawMsg = body?.error?.message;
  const message = typeof rawMsg === 'string' && rawMsg.trim() ? rawMsg : FALLBACK_MESSAGE[code];
  return new ApiError(res.status, code, message, body?.error?.details ?? null);
}

interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  /** Không gọi handler 401 (dùng cho chính lệnh đăng nhập). */
  skipAuthRedirect?: boolean;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      credentials: 'include',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', FALLBACK_MESSAGE.NETWORK, null);
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (err.status === 401 && !opts.skipAuthRedirect) unauthorizedHandler?.();
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Gửi file (multipart) — dùng XMLHttpRequest để báo tiến độ tải lên (file lớn).
 * Lỗi trả về như mọi lệnh khác (ApiError, 401 ⇒ về màn đăng nhập).
 */
function upload<T>(path: string, form: FormData, query?: QueryParams, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl(path, query));
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    if (onProgress) xhr.upload.onprogress = (ev) => ev.lengthComputable && onProgress(Math.round((ev.loaded / ev.total) * 100));
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', FALLBACK_MESSAGE.NETWORK, null));
    xhr.onload = () => {
      const res = new Response(xhr.responseText || null, { status: xhr.status, headers: { 'Content-Type': 'application/json' } });
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
        return;
      }
      void toApiError(res).then((err) => {
        if (err.status === 401) unauthorizedHandler?.();
        reject(err);
      });
    };
    xhr.send(form);
  });
}

export const api = {
  upload,
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  del: <T>(path: string, query?: QueryParams) => request<T>('DELETE', path, { query }),
};
