// Một kết nối SSE dùng chung cho cả ứng dụng (GET /api/events).
// - Nhận sự kiện ⇒ invalidate cache TanStack Query liên quan (dữ liệu luôn lấy lại bằng GET).
// - Mất kết nối ⇒ tự nối lại (lùi dần 3s → 30s); nối lại được ⇒ làm mới mọi dữ liệu vì có thể đã lỡ sự kiện.
// - Màn hình khác đăng ký nghe riêng bằng `useServerEvent(handler)` (vd. "Phiếu vừa được máy 2 sửa").
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { qk } from '../api/queryKeys';
import type { ServerEvent } from '../api/types';

export type LiveStatus = 'connecting' | 'open' | 'reconnecting';

type Listener = (e: ServerEvent) => void;

interface EventsContextValue {
  status: LiveStatus;
  subscribe: (fn: Listener) => () => void;
}

const EventsContext = createContext<EventsContextValue | null>(null);

function isServerEvent(x: unknown): x is ServerEvent {
  if (!x || typeof x !== 'object') return false;
  const t = (x as { type?: unknown }).type;
  return t === 'document.changed' || t === 'voucher.changed' || t === 'catalog.changed';
}

/** Ánh xạ sự kiện ⇒ những cache cần làm mới. */
export function invalidateFor(qc: QueryClient, e: ServerEvent): void {
  const inv = (f: readonly unknown[] | { predicate: (q: { queryKey: readonly unknown[] }) => boolean }) =>
    void qc.invalidateQueries(Array.isArray(f) ? { queryKey: f } : (f as { predicate: (q: { queryKey: readonly unknown[] }) => boolean }));
  switch (e.type) {
    case 'catalog.changed':
      inv(qk.catalog(e.entity));
      if (e.entity === 'product') {
        inv(['price-info', e.id]);
        inv(qk.reports);
      }
      if (e.entity === 'partner') {
        inv(qk.reports);
        inv(qk.dashboard);
      }
      if (e.entity === 'cash_account') inv(qk.dashboard);
      if (e.entity === 'warehouse' || e.entity === 'product_group') inv(qk.reports);
      break;
    case 'document.changed':
      inv(qk.documents);
      if (e.action === 'deleted') {
        // phiếu đã xóa: bỏ khỏi bộ nhớ đệm, KHÔNG tải lại (tránh gọi tới phiếu không còn — 404)
        void qc.cancelQueries({ queryKey: ['document', e.id] });
        qc.removeQueries({ queryKey: ['document', e.id] });
        qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'document-check' && String(q.queryKey[1] ?? '').includes(`"id":${e.id}`) });
      } else inv(qk.document(e.id));
      inv(['price-info']);
      inv(['document-check']);
      inv(qk.catalog('product')); // tồn trong danh sách gợi ý mã hàng (with_stock)
      inv(qk.reports);
      inv(qk.dashboard);
      break;
    case 'voucher.changed':
      inv(qk.vouchers);
      if (e.action === 'deleted') {
        void qc.cancelQueries({ queryKey: ['voucher', e.id] });
        qc.removeQueries({ queryKey: ['voucher', e.id] });
      } else inv(qk.voucher(e.id));
      // "Nợ cũ / Tổng nợ" trên phiếu bán/mua phụ thuộc phiếu thu chi
      inv(['document']);
      inv(qk.reports);
      inv(qk.dashboard);
      break;
  }
}

export function EventsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: number | undefined;
    let attempt = 0;
    let stopped = false;
    let hadError = false;

    const connect = () => {
      if (stopped) return;
      es = new EventSource('/api/events', { withCredentials: true });
      es.onopen = () => {
        setStatus('open');
        attempt = 0;
        if (hadError) {
          // Có thể đã lỡ sự kiện trong lúc mất kết nối.
          void qc.invalidateQueries();
          hadError = false;
        }
      };
      es.onmessage = (msg: MessageEvent<string>) => {
        let data: unknown;
        try {
          data = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (!isServerEvent(data)) return;
        invalidateFor(qc, data);
        listeners.current.forEach((fn) => fn(data));
      };
      es.onerror = () => {
        hadError = true;
        setStatus('reconnecting');
        // Trình duyệt tự nối lại khi còn CONNECTING; chỉ tự xử lý khi đã CLOSED (vd. 401, máy chủ tắt hẳn).
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          const delay = Math.min(30000, 3000 * 2 ** attempt);
          attempt += 1;
          timer = window.setTimeout(() => {
            // Kiểm tra phiên trước: 401 ⇒ client.ts tự đưa về màn đăng nhập.
            api
              .get('/auth/me')
              .then(connect)
              .catch((err: unknown) => {
                if (err instanceof ApiError && err.status === 401) return;
                connect();
              });
          }, delay);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      es?.close();
    };
  }, [qc]);

  const value = useRef<EventsContextValue>({
    status,
    subscribe: (fn) => {
      listeners.current.add(fn);
      return () => listeners.current.delete(fn);
    },
  });
  value.current = { ...value.current, status };

  return <EventsContext.Provider value={value.current}>{children}</EventsContext.Provider>;
}

export function useLiveStatus(): LiveStatus {
  const ctx = useContext(EventsContext);
  return ctx?.status ?? 'connecting';
}

/** Nghe sự kiện máy chủ trong một màn hình. `handler` có thể đổi mỗi lần render. */
export function useServerEvent(handler: Listener): void {
  const ctx = useContext(EventsContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!ctx) return undefined;
    return ctx.subscribe((e) => ref.current(e));
  }, [ctx?.subscribe]); // eslint-disable-line react-hooks/exhaustive-deps
}
