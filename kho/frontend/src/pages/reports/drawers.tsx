// Ngăn kéo chi tiết xếp chồng: báo cáo → thẻ kho → phiếu …, Esc đóng từng tầng. Mọi màn dùng chung qua useDrawers().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'antd';
import { DocumentView } from './DocumentView';
import { StockLedgerView } from './StockLedgerView';
import { TradeReportView } from './TradeReportView';
import type { ProductPick } from '../../components/ProductSelect';
import type { DebtSide } from '../../api/types';
import { VoucherView } from '../vouchers/VoucherView';
import { DebtLedgerView, type PartnerRef } from '../vouchers/DebtLedgerView';

export type DrawerEntry =
  | { kind: 'document'; id: number; title?: string }
  | { kind: 'ledger'; product: ProductPick; warehouseId?: number; from?: string; to?: string }
  | { kind: 'trade'; report: 'sales' | 'purchases'; product: ProductPick }
  | { kind: 'voucher'; id: number; title?: string }
  | { kind: 'debt'; partner: PartnerRef; side: DebtSide; from?: string; to?: string };

interface Ctx {
  push: (e: DrawerEntry) => void;
  pop: () => void;
  clear: () => void;
  depth: number;
}

const DrawerCtx = createContext<Ctx | null>(null);

export function useDrawers(): Ctx {
  const c = useContext(DrawerCtx);
  if (!c) throw new Error('useDrawers ngoài DrawerStackProvider');
  return c;
}

function titleOf(e: DrawerEntry): string {
  switch (e.kind) {
    case 'document':
      return e.title ?? 'Chứng từ';
    case 'ledger':
      return `Thẻ kho — ${e.product.code} ${e.product.name}`;
    case 'voucher':
      return e.title ?? 'Phiếu thu chi';
    case 'debt':
      return `Công nợ ${e.side === 'receivable' ? 'phải thu' : 'phải trả'} — ${e.partner.code} ${e.partner.name}`;
    case 'trade':
      return `${e.report === 'sales' ? 'Lịch sử bán' : 'Lịch sử mua'} — ${e.product.code} ${e.product.name}`;
  }
}

export function DrawerStackProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ key: number; e: DrawerEntry }[]>([]);
  const seq = useRef(0);
  const push = useCallback((e: DrawerEntry) => setStack((s) => [...s, { key: ++seq.current, e }]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const clear = useCallback(() => setStack([]), []);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  // Esc đóng tầng trên cùng (trừ khi đang có hộp thoại hoặc danh sách chọn đang mở)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !stackRef.current.length) return;
      const t = ev.target as HTMLElement | null;
      if (t?.getAttribute?.('aria-expanded') === 'true') return;
      const modalOpen = [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap')].some((w) => getComputedStyle(w).display !== 'none');
      if (modalOpen) return;
      ev.preventDefault();
      ev.stopPropagation();
      setStack((s) => s.slice(0, -1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const value = useMemo(() => ({ push, pop, clear, depth: stack.length }), [push, pop, clear, stack.length]);
  const base = Math.min(1120, typeof window !== 'undefined' ? window.innerWidth - 230 : 1100);

  return (
    <DrawerCtx.Provider value={value}>
      {children}
      {stack.map(({ key, e }, i) => (
        <Drawer
          key={key}
          open
          title={
            <span>
              {titleOf(e)}
              {i > 0 && <span className="drawer-depth"> · tầng {i + 1}</span>}
            </span>
          }
          width={Math.max(560, base - i * 48)}
          keyboard={false}
          onClose={() => setStack((s) => s.filter((x) => x.key !== key))}
          zIndex={1000 + i * 10}
          destroyOnHidden
          styles={{ body: { display: 'flex', flexDirection: 'column', padding: 12, gap: 8 } }}
          className="detail-drawer"
          extra={<span className="muted drawer-esc">Esc đóng</span>}
        >
          {e.kind === 'document' && <DocumentView id={e.id} />}
          {e.kind === 'ledger' && <StockLedgerView product={e.product} initialWarehouseId={e.warehouseId} initialFrom={e.from} initialTo={e.to} inDrawer />}
          {e.kind === 'trade' && <TradeReportView kind={e.report} fixedProduct={e.product} inDrawer />}
          {e.kind === 'voucher' && <VoucherView id={e.id} />}
          {e.kind === 'debt' && <DebtLedgerView partner={e.partner} side={e.side} initialFrom={e.from} initialTo={e.to} />}
        </Drawer>
      ))}
    </DrawerCtx.Provider>
  );
}
