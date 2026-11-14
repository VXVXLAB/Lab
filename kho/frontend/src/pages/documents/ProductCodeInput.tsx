import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { productsApi } from '../../api/catalog';
import { ApiError } from '../../api/client';
import type { Product, ProductWithStock } from '../../api/types';
import { foldVietnamese, matchText, searchWords } from '../../lib/text';
import { formatMoney, formatQty } from '../../lib/format';

interface Props {
  value: string;
  onTextChange: (s: string) => void;
  onPick: (p: Product) => void;
  /** Phím không xử lý ở đây (mũi tên khi danh sách đóng, Enter khi ô trống…) */
  onOtherKey?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  allowService: boolean;
  priceField: 'sale_price' | 'purchase_price' | null;
  /** Kho của phiếu: danh sách gợi ý hiện tồn tại kho này / tổng */
  warehouseId?: number | null;
  invalid?: boolean;
  placeholder?: string;
  disabled?: boolean;
  'data-cell'?: string;
}

export interface ProductCodeInputHandle {
  focus: () => void;
}

const SERVICE_ALIASES = new Set(['dv', 'dichvu', 'dich vu']);

function rank(p: Product, text: string): number {
  const t = foldVietnamese(text);
  const code = foldVietnamese(p.code);
  if (code === t) return 0;
  if (SERVICE_ALIASES.has(t) && p.code === 'DV') return 0;
  if (code.startsWith(t)) return 1;
  if (code.includes(t)) return 2;
  return 3;
}

async function search(text: string, allowService: boolean, warehouseId: number | null | undefined): Promise<ProductWithStock[]> {
  const t = text.trim();
  // Nhiều từ ("que 3.2", "kiswel 3.2"): máy chủ tìm theo chuỗi liền ⇒ hỏi theo từ dài nhất rồi lọc đủ mọi từ tại máy.
  const words = searchWords(t);
  const longest = [...words].sort((a, b) => b.length - a.length)[0] ?? t;
  const multi = words.length > 1;
  const listP = productsApi
    .listWithStock({ q: multi ? longest : t, active: true, page_size: multi ? 200 : 20, is_service: allowService ? undefined : false, warehouse_id: warehouseId })
    .then((r) =>
      multi ? { ...r, items: r.items.filter((p) => matchText(t, `${p.code} ${p.name}`)).slice(0, 20) } : r,
    );
  // Tra chính xác theo mã (hiểu cả DICHVU ⇒ DV) chạy song song — người gõ đủ mã + Enter luôn trúng.
  const exactP = /\s/.test(t)
    ? Promise.resolve(null)
    : productsApi.lookup(t).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      });
  const [list, exact] = await Promise.all([listP, exactP]);
  let items: ProductWithStock[] = list.items;
  if (exact && exact.active && (allowService || !exact.is_service) && !items.some((p) => p.id === exact.id)) items = [exact, ...items];
  return [...items].sort((a, b) => rank(a, t) - rank(b, t) || a.code.localeCompare(b.code));
}

/**
 * Ô "Mã hàng" trong lưới phiếu: gõ mã hoặc một phần tên ⇒ danh sách gợi ý (mã, tên, ĐVT, giá, tồn);
 * ↑↓ chọn, Enter lấy. Gõ đủ mã rồi Enter ngay cũng được (không cần chờ danh sách).
 */
export const ProductCodeInput = forwardRef<ProductCodeInputHandle, Props>(function ProductCodeInput(
  { value, onTextChange, onPick, onOtherKey, allowService, priceField, warehouseId, invalid, placeholder, disabled, ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ProductWithStock[]>([]);
  const [resultsFor, setResultsFor] = useState('');
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const seq = useRef(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const run = async (text: string): Promise<ProductWithStock[]> => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await search(text, allowService, warehouseId);
      if (my === seq.current) {
        setResults(r);
        setResultsFor(text);
        setActive(0);
        setNotFound(r.length === 0);
      }
      return r;
    } catch {
      return [];
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  // tìm khi gõ (trễ 120ms)
  useEffect(() => {
    if (!open) return undefined;
    const t = value.trim();
    if (!t) {
      setResults([]);
      setResultsFor('');
      setNotFound(false);
      return undefined;
    }
    const h = window.setTimeout(() => void run(t), 120);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, open]);

  useEffect(() => {
    if (open && inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  }, [open, results]);

  const pick = (p: Product) => {
    setOpen(false);
    setNotFound(false);
    onPick(p);
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    const t = value.trim();
    if (e.key === 'ArrowDown' && open && results.length) {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
      return;
    }
    if (e.key === 'ArrowUp' && open && results.length) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && t) {
      e.preventDefault();
      e.stopPropagation();
      if (open && resultsFor === t && results.length) {
        const chosen = results[active];
        if (chosen) pick(chosen);
        return;
      }
      const r = await run(t);
      const first = r[0];
      if (first && (r.length === 1 || rank(first, t) === 0)) pick(first);
      else {
        setOpen(true);
        setNotFound(r.length === 0);
      }
      return;
    }
    onOtherKey?.(e);
  };

  const t = value.trim();
  const showList = open && !!t && (results.length > 0 || notFound || loading);

  return (
    <>
      <input
        ref={inputRef}
        className={`cell-input code-input${invalid ? ' cell-invalid' : ''}`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        {...rest}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          onTextChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => void onKeyDown(e)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {showList &&
        rect &&
        createPortal(
          <div
            className="product-dropdown"
            style={{
              left: Math.min(rect.left, window.innerWidth - 700),
              top: rect.bottom + 2 + 330 > window.innerHeight ? undefined : rect.bottom + 2,
              bottom: rect.bottom + 2 + 330 > window.innerHeight ? window.innerHeight - rect.top + 2 : undefined,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {results.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Mã hàng</th>
                    <th>Tên hàng</th>
                    <th>ĐVT</th>
                    {priceField && <th className="num">{priceField === 'sale_price' ? 'Giá bán' : 'Giá mua'}</th>}
                    <th className="num">{warehouseId ? 'Tồn kho này / tổng' : 'Tồn'}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((p, i) => {
                    const st = warehouseId ? p.warehouse_qty : p.total_stock;
                    return (
                      <tr key={p.id} className={i === active ? 'active' : undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(p)}>
                        <td className="code">{p.code}</td>
                        <td>{p.name}</td>
                        <td>{p.unit}</td>
                        {priceField && <td className="num">{p.is_service ? '' : formatMoney(p[priceField])}</td>}
                        <td className={`num${st !== undefined && st <= 0 ? ' neg' : ''}`}>
                          {p.is_service ? 'dịch vụ' : st === undefined ? '…' : formatQty(st)}
                          {!p.is_service && warehouseId && p.total_stock !== undefined && <span className="stock-total-mini"> / {formatQty(p.total_stock)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="dd-empty">{loading ? 'Đang tìm…' : `Không có mã hàng nào khớp "${t}". Kiểm tra lại mã, hoặc thêm mã mới ở Danh mục › Hàng hóa.`}</div>
            )}
            <div className="dd-hint">↑↓ chọn · Enter lấy · Esc đóng{allowService ? ' · gõ DV cho dòng dịch vụ / ghi chú' : ''}</div>
          </div>,
          document.body,
        )}
    </>
  );
});
