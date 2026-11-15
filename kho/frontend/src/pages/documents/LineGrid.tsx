import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Tooltip } from 'antd';
import { DeleteOutlined, FileSearchOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { Checkbox } from 'antd';
import type { PriceInfoWh, Product } from '../../api/types';
import { NumberInput } from '../../components/NumberInput';
import { formatDate, formatMoney, formatQty } from '../../lib/format';
import type { DocTypeConfig } from './docTypes';
import { emptyLine, fromProduct, isBlank, lineAmount, withTrailingBlank, type LineDraft, type ProductLite } from './draft';
import { ProductCodeInput } from './ProductCodeInput';

export type Col = 'code' | 'desc' | 'qty' | 'price' | 'note';

export interface LineHint {
  /** Thiếu hàng (phiếu xuất): số thiếu và tồn hiện có */
  shortage?: { short: number; available: number; required?: number; date?: string; docDate?: string; message?: string };
  /** Bán lỗ: giá vốn so sánh */
  /** Bán lỗ: giá mua (null: có lỗ nhưng giá mua bị che với người không có quyền xem giá mua) */
  loss?: number | null;
  /** Bản mở rộng C6: nguồn giá đang dùng ("Giá riêng của khách"…) */
  priceTag?: string;
  /** Bản mở rộng C6: giá đã sửa khác giá theo khách ⇒ "Lưu giá này cho khách" */
  onSavePrice?: () => void;
  /** Lỗi máy chủ trả về cho dòng này */
  error?: string;
}

interface Props {
  cfg: DocTypeConfig;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  readOnly: boolean;
  warehouseId: number | null;
  priceInfo: (productId: number) => PriceInfoWh | undefined;
  /** Hiện cột ghi chú từng dòng */
  showNote: boolean;
  onToggleNote: (v: boolean) => void;
  /** F6 thẻ kho, F7 lịch sử bán/mua của mã ở dòng đang đứng */
  onShowLedger?: (p: ProductLite) => void;
  onShowHistory?: (p: ProductLite) => void;
  hints: Record<string, LineHint>;
  /** Bản mở rộng C6: báo vừa chọn mã cho dòng (giá đang là giá tự điền) */
  onPicked?: (lineKey: string, productId: number, price: number | null) => void;
  /** Yêu cầu đặt con trỏ từ ngoài (vd. sau lỗi máy chủ) */
  focusRequest?: { key: string; col: Col; n: number } | null;
}

/**
 * Lưới dòng hàng: STT | Mã hàng | Tên hàng / diễn giải | ĐVT | SL | Đơn giá | Thành tiền | Tồn | xóa.
 * Bàn phím: Enter đi Mã → SL → Đơn giá → dòng sau (dịch vụ: Mã → Diễn giải → Đơn giá);
 * ↑↓ đổi dòng cùng cột; Ctrl+Delete xóa dòng; Ctrl+Insert chèn dòng phía trên.
 */
export function LineGrid({ cfg, lines, onChange, readOnly, warehouseId, priceInfo, showNote, onToggleNote, onShowLedger, onShowHistory, hints, focusRequest, onPicked }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ key: string; col: Col } | null>(null);

  const focus = (key: string, col: Col) => setPending({ key, col });

  useEffect(() => {
    if (focusRequest) setPending({ key: focusRequest.key, col: focusRequest.col });
  }, [focusRequest]);

  // đặt con trỏ ngay sau khi vẽ (trước khi trình duyệt nhận phím kế tiếp)
  useLayoutEffect(() => {
    if (!pending) return;
    const el = wrapRef.current?.querySelector<HTMLInputElement>(`[data-cell="${pending.key}:${pending.col}"]`);
    if (el) {
      el.focus();
      el.select();
      el.closest('tr')?.scrollIntoView({ block: 'nearest' });
    }
    setPending(null);
  }, [pending, lines]);

  const update = (key: string, patch: Partial<LineDraft>) => {
    onChange(withTrailingBlank(lines.map((l) => (l.key === key ? { ...l, ...patch } : l))));
  };

  const removeLine = (key: string) => {
    const idx = lines.findIndex((l) => l.key === key);
    const next = withTrailingBlank(lines.filter((l) => l.key !== key));
    onChange(next);
    const target = next[Math.min(idx, next.length - 1)];
    if (target) focus(target.key, 'code');
  };

  const insertBefore = (key: string) => {
    const idx = lines.findIndex((l) => l.key === key);
    const nl = emptyLine();
    const next = [...lines.slice(0, idx), nl, ...lines.slice(idx)];
    onChange(next);
    focus(nl.key, 'code');
  };

  const moveLine = (key: string, dir: 1 | -1, col: Col) => {
    const idx = lines.findIndex((l) => l.key === key);
    const j = idx + dir;
    const cur = lines[idx];
    const other = lines[j];
    if (!cur || !other || isBlank(cur) || isBlank(other)) return;
    const next = [...lines];
    next[idx] = other;
    next[j] = cur;
    onChange(next);
    focus(key, col);
  };

  const pick = (l: LineDraft, p: Product) => {
    let price: number | null = null;
    if (cfg.hasPrice) {
      if (l.product?.id === p.id) price = l.unit_price; // chọn lại đúng mã: giữ giá đã sửa
      else if (!p.is_service && cfg.defaultPrice) price = p[cfg.defaultPrice]; // REQ-026 giá mặc định
    }
    update(l.key, {
      product: fromProduct(p),
      codeText: p.code,
      unit: p.unit,
      description: p.is_service ? l.description : '',
      qty: l.qty ?? 1,
      unit_price: price,
    });
    if (!p.is_service && l.product?.id !== p.id) onPicked?.(l.key, p.id, price);
    focus(l.key, p.is_service ? 'desc' : 'qty');
  };

  const nextRowKey = (key: string, dir: 1 | -1): string | undefined => {
    const idx = lines.findIndex((l) => l.key === key);
    return lines[idx + dir]?.key;
  };

  const afterLast = (l: LineDraft) => {
    const nk = nextRowKey(l.key, 1);
    if (nk) focus(nk, 'code');
    else {
      const nl = emptyLine();
      onChange([...lines, nl]);
      focus(nl.key, 'code');
    }
  };

  const onCellKey = (l: LineDraft, col: Col) => (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'F6' || e.key === 'F7') && l.product && !l.product.is_service) {
      e.preventDefault();
      (e.key === 'F6' ? onShowLedger : onShowHistory)?.(l.product);
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveLine(l.key, e.key === 'ArrowDown' ? 1 : -1, col);
      return;
    }
    if (e.key === 'Delete' && e.ctrlKey) {
      e.preventDefault();
      removeLine(l.key);
      return;
    }
    if (e.key === 'Insert' && e.ctrlKey) {
      e.preventDefault();
      insertBefore(l.key);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const nk = nextRowKey(l.key, e.key === 'ArrowDown' ? 1 : -1);
      if (nk) {
        e.preventDefault();
        const target = lines.find((x) => x.key === nk);
        const c: Col = col === 'desc' && !target?.product?.is_service ? 'code' : col;
        if (e.altKey) return;
        focus(nk, c);
      }
      return;
    }
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const service = !!l.product?.is_service;
    if (col === 'code') {
      // ô mã trống: dòng trống cuối ⇒ không làm gì (Ctrl+S lưu, F9 ghi sổ)
      if (!isBlank(l) && l.product) focus(l.key, service ? 'desc' : 'qty');
      return;
    }
    if (col === 'desc' || col === 'qty') {
      if (cfg.hasPrice) focus(l.key, 'price');
      else if (showNote) focus(l.key, 'note');
      else afterLast(l);
      return;
    }
    if (col === 'price' && showNote) {
      focus(l.key, 'note');
      return;
    }
    afterLast(l);
  };

  const showStock = true;

  return (
    <div className="line-grid" ref={wrapRef}>
      <table>
        <colgroup>
          <col style={{ width: 40 }} />
          <col style={{ width: 150 }} />
          <col />
          <col style={{ width: 64 }} />
          <col style={{ width: 100 }} />
          {cfg.hasPrice && <col style={{ width: 120 }} />}
          {cfg.hasPrice && <col style={{ width: 122 }} />}
          {showNote && <col style={{ width: 150 }} />}
          {showStock && <col style={{ width: 104 }} />}
          {!readOnly && <col style={{ width: 84 }} />}
        </colgroup>
        <thead>
          <tr>
            <th className="num">STT</th>
            <th>Mã hàng</th>
            <th>Tên hàng / diễn giải</th>
            <th>ĐVT</th>
            <th className="num">Số lượng</th>
            {cfg.hasPrice && <th className="num">Đơn giá</th>}
            {cfg.hasPrice && <th className="num">Thành tiền</th>}
            {showNote && <th>Ghi chú dòng</th>}
            {showStock && (
              <th className="num">
                <Tooltip title="Tồn tại kho đang chọn (đến hết ngày phiếu) · tổng các kho">Tồn kho</Tooltip>
              </th>
            )}
            {!readOnly && <th />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const blank = isBlank(l);
            const service = !!l.product?.is_service;
            const h = hints[l.key] ?? {};
            const pi = l.product && !service ? priceInfo(l.product.id) : undefined;
            const whQty = pi ? (pi.warehouse_qty ?? pi.stock_by_warehouse.find((s) => s.warehouse_id === warehouseId)?.qty ?? 0) : undefined;
            const total = pi?.total_stock;
            const amount = lineAmount(l);
            const rowCls = [
              blank ? 'row-blank' : '',
              service ? 'row-service' : '',
              h.loss !== undefined ? 'row-loss' : '',
              h.shortage ? 'row-short' : '',
              h.error ? 'row-error' : '',
            ]
              .filter(Boolean)
              .join(' ');
            if (readOnly && blank) return null;
            return (
              <tr key={l.key} className={rowCls}>
                <td className="num stt">{blank ? '' : i + 1}</td>
                <td>
                  {readOnly ? (
                    l.product && !service && onShowLedger ? (
                      <Tooltip title="Xem thẻ kho mã này">
                        <span className="ro code code-link" onClick={() => l.product && onShowLedger(l.product)}>
                          {l.product.code}
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="ro code">{l.product?.code ?? l.codeText}</span>
                    )
                  ) : (
                    <ProductCodeInput
                      data-cell={`${l.key}:code`}
                      value={l.codeText}
                      invalid={!!h.error}
                      placeholder={blank ? (i === 0 ? 'Gõ mã hoặc tên hàng' : 'Mã hàng…') : undefined}
                      onTextChange={(s) =>
                        update(l.key, l.product && s !== l.product.code ? { codeText: s, product: null } : { codeText: s })
                      }
                      onPick={(p) => pick(l, p)}
                      onOtherKey={onCellKey(l, 'code')}
                      allowService={cfg.allowService}
                      priceField={cfg.defaultPrice}
                      warehouseId={warehouseId}
                    />
                  )}
                </td>
                <td className="desc-cell">
                  {service ? (
                    readOnly ? (
                      <span className="ro">{l.description}</span>
                    ) : (
                      <input
                        className="cell-input"
                        data-cell={`${l.key}:desc`}
                        value={l.description}
                        placeholder="Diễn giải (vd. PHÍ SỬA XE, TRẢ 01 ĐỒNG HỒ)"
                        onChange={(e) => update(l.key, { description: e.target.value })}
                        onKeyDown={onCellKey(l, 'desc')}
                        onFocus={(e) => e.target.select()}
                        maxLength={500}
                      />
                    )
                  ) : (
                    <span className="ro">{l.product?.name ?? (l.codeText.trim() ? <span className="muted">Chọn mã trong danh sách gợi ý (Enter)</span> : '')}</span>
                  )}
                  {service && (
                    <div className="line-note service-note">
                      Dịch vụ — không tính tồn kho ·{' '}
                      {l.unit_price === null
                        ? 'dòng ghi chú (không tiền)'
                        : l.unit_price < 0
                          ? `trừ ${formatMoney(-amount)} vào tổng phiếu`
                          : `cộng ${formatMoney(amount)} vào tổng phiếu`}
                    </div>
                  )}
                  {h.error && <div className="line-note neg">{h.error}</div>}
                </td>
                <td>
                  <span className="ro">{l.product ? l.unit : ''}</span>
                </td>
                <td className="num">
                  {readOnly ? (
                    <span className="ro">{blank ? '' : formatQty(l.qty, true)}</span>
                  ) : (
                    <NumberInput
                      kind="qty"
                      className="cell-num"
                      variant="borderless"
                      dataCell={`${l.key}:qty`}
                      value={l.qty}
                      disabled={!l.product}
                      onChange={(v) => update(l.key, { qty: v })}
                      onKeyDown={onCellKey(l, 'qty')}
                      aria-label={`Số lượng dòng ${i + 1}`}
                    />
                  )}
                  {h.shortage && (
                    <div className="line-note neg" title={h.shortage.message}>
                      {h.shortage.required === 0 ? (
                        <>Làm âm kho {formatQty(h.shortage.short)}</>
                      ) : (
                        <>
                          Thiếu {formatQty(h.shortage.short)} — tồn {formatQty(h.shortage.available)}
                        </>
                      )}
                      {h.shortage.date && h.shortage.date !== h.shortage.docDate && <> (ngày {formatDate(h.shortage.date).slice(0, 5)})</>}
                    </div>
                  )}
                </td>
                {cfg.hasPrice && (
                  <td className="num">
                    {readOnly ? (
                      <span className="ro">{l.unit_price === null ? '' : formatMoney(l.unit_price)}</span>
                    ) : (
                      <NumberInput
                        kind="money"
                        className="cell-num"
                        variant="borderless"
                        allowNegative={service}
                        dataCell={`${l.key}:price`}
                        value={l.unit_price}
                        disabled={!l.product}
                        placeholder={service ? 'để trống' : undefined}
                        onChange={(v) => update(l.key, { unit_price: v })}
                        onKeyDown={onCellKey(l, 'price')}
                        aria-label={`Đơn giá dòng ${i + 1}`}
                      />
                    )}
                    {h.loss !== undefined ? (
                      <div className="line-note neg">{h.loss === null ? 'Bán lỗ (thấp hơn giá mua)' : `Bán lỗ: giá mua ${formatMoney(h.loss)}`}</div>
                    ) : cfg.lossCheck && pi && pi.cost_source !== 'none' && pi.cost_price !== null && !readOnly ? (
                      <div className="line-note muted">giá mua {formatMoney(pi.cost_price)}</div>
                    ) : null}
                    {h.priceTag && <div className="line-note price-src">{h.priceTag}</div>}
                    {h.onSavePrice && !readOnly && (
                      <button type="button" className="line-note link-btn" tabIndex={-1} onClick={h.onSavePrice}>
                        Lưu giá này cho khách
                      </button>
                    )}
                  </td>
                )}
                {cfg.hasPrice && (
                  <td className="num amount">
                    {!l.product || (service && l.unit_price === null) ? '' : formatMoney(amount)}
                  </td>
                )}
                {showNote && (
                  <td>
                    {readOnly ? (
                      <span className="ro">{l.note}</span>
                    ) : (
                      <input
                        className="cell-input"
                        data-cell={`${l.key}:note`}
                        value={l.note}
                        disabled={!l.product}
                        placeholder={l.product ? 'ghi chú…' : ''}
                        maxLength={500}
                        onChange={(e) => update(l.key, { note: e.target.value })}
                        onKeyDown={onCellKey(l, 'note')}
                        onFocus={(e) => e.target.select()}
                      />
                    )}
                  </td>
                )}
                {showStock && (
                  <td className="num stock">
                    {l.product && !service && (
                      <>
                        <span className={whQty !== undefined && whQty <= 0 ? 'neg' : undefined}>{whQty === undefined ? '…' : formatQty(whQty)}</span>
                        <span className="stock-total-mini"> / {total === undefined ? '…' : formatQty(total)}</span>
                      </>
                    )}
                  </td>
                )}
                {!readOnly && (
                  <td className="act">
                    {l.product && !service && (
                      <span className="row-tools">
                        <Tooltip title="Thẻ kho mã này (F6)">
                          <Button type="text" size="small" tabIndex={-1} icon={<FileSearchOutlined />} aria-label="Thẻ kho" onClick={() => l.product && onShowLedger?.(l.product)} />
                        </Tooltip>
                        <Tooltip title={`Lịch sử ${cfg.type.startsWith('purchase') ? 'mua' : 'bán'} mã này (F7)`}>
                          <Button type="text" size="small" tabIndex={-1} icon={<HistoryOutlined />} aria-label="Lịch sử" onClick={() => l.product && onShowHistory?.(l.product)} />
                        </Tooltip>
                      </span>
                    )}
                    {!blank && (
                      <Tooltip title="Xóa dòng (Ctrl+Delete)">
                        <Button
                          type="text"
                          size="small"
                          danger
                          tabIndex={-1}
                          icon={<DeleteOutlined />}
                          aria-label={`Xóa dòng ${i + 1}`}
                          onClick={() => removeLine(l.key)}
                        />
                      </Tooltip>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && (
        <div className="grid-tools">
          <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => afterLast(lines[lines.length - 1] ?? emptyLine())} tabIndex={-1}>
            Thêm dòng
          </Button>
          <Checkbox checked={showNote} onChange={(e) => onToggleNote(e.target.checked)} tabIndex={-1}>
            Ghi chú dòng
          </Checkbox>
          <span className="hint">
            Enter: Mã → SL → Giá → dòng sau · Alt+↑↓ dời dòng · Ctrl+Del xóa · Ctrl+Ins chèn · F6 thẻ kho · F7 lịch sử · <b>DV</b> = dịch vụ
          </span>
        </div>
      )}
    </div>
  );
}
