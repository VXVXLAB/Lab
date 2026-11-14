import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { filterByLabel } from '../../lib/text';
import { createPortal } from 'react-dom';
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Dropdown, Input, Modal, Result, Segmented, Select, Skeleton, Space, Tag, Tooltip, type InputRef } from 'antd';
import {
  ArrowLeftOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileExcelOutlined,
  FileWordOutlined,
  HistoryOutlined,
  PrinterOutlined,
  RollbackOutlined,
  SaveOutlined,
  CheckCircleOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { productsApi } from '../../api/catalog';
import { useWarehouses } from '../../api/hooks';
import { reportApi } from '../../api/reports';
import { useDebounced } from '../../lib/useDebounced';
import { ApiError, errorMessage } from '../../api/client';
import { documentsApi } from '../../api/documents';
import { qk } from '../../api/queryKeys';
import type { DocType, DocumentFull, LossWarning, PriceInfoWh, Shortage, VersionConflictDetails, Warehouse } from '../../api/types';
import { useCurrentUser } from '../../auth/AuthContext';
import { DateInput } from '../../components/DateInput';
import { Kbd } from '../../components/Kbd';
import { useServerEvent } from '../../lib/events';
import { formatDate, formatDateTime, formatMoney, formatQty, toApiDate, todayVn } from '../../lib/format';
import { enterToNext, useHotkeys } from '../../lib/keyboard';
import { storage } from '../../lib/storage';
import { useMenuHighlight } from '../../lib/menuHighlight';
import { paths } from '../../paths';
import { DOC_TYPES, isDocType } from './docTypes';
import {
  draftFromDoc,
  applyChanges,
  diffLines,
  emptyLine,
  fingerprint,
  isBlank,
  lineAmount,
  sentLines,
  toBody,
  withTrailingBlank,
  type HeaderDraft,
  type LineChange,
  type LineDraft,
} from './draft';
import { HistoryDrawer } from './HistoryDrawer';

const CHANGE_LABEL = { added: 'Thêm mới', edited: 'Đã sửa', removed: 'Đã xóa' } as const;
import { useDrawers } from '../reports/drawers';
import { LineGrid, type Col, type LineHint } from './LineGrid';
import { PartnerSelect } from './PartnerSelect';
import { PrintSheet } from './PrintSheet';

const LAST_WH = 'kho.lastWarehouse';
const NOTE_KEY = 'kho.showLineNote';

/** Route /chung-tu/:id và /chung-tu/moi?loai=… — giữ nguyên trình soạn khi phiếu mới vừa được lưu (đổi URL sang id). */
export function DocumentRoute() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const location = useLocation();
  const alias = useRef(new Map<string, string>());
  if (id === 'moi') {
    const t = sp.get('loai') ?? undefined;
    if (!isDocType(t)) return <Result status="404" title="Không rõ loại phiếu" />;
    const key = `new:${t}:${location.key}`;
    return <DocumentEditor key={key} docId={null} newType={t} onCreated={(newId) => alias.current.set(String(newId), key)} />;
  }
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return <Result status="404" title="Không tìm thấy phiếu" />;
  return <DocumentEditor key={alias.current.get(String(n)) ?? `doc:${n}`} docId={n} newType={null} onCreated={() => undefined} />;
}

interface EditorProps {
  docId: number | null;
  newType: DocType | null;
  onCreated: (id: number) => void;
}

function StatusBadge({ doc, editing, isNew }: { doc: DocumentFull | null; editing: boolean; isNew: boolean }) {
  if (isNew || !doc) return <span className="doc-status st-new">PHIẾU MỚI — chưa lưu</span>;
  if (doc.status === 'draft') return <span className="doc-status st-draft">PHIẾU TẠM — chưa ghi sổ</span>;
  if (editing) return <span className="doc-status st-editing">ĐANG SỬA phiếu đã ghi sổ</span>;
  return <span className="doc-status st-posted">ĐÃ GHI SỔ</span>;
}

function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function DocumentEditor({ docId, newType, onCreated }: EditorProps) {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { modal, message } = App.useApp();

  const docQ = useQuery({
    queryKey: qk.document(docId ?? 0),
    queryFn: () => documentsApi.get(docId ?? 0),
    enabled: docId !== null,
  });
  const [loaded, setLoaded] = useState<DocumentFull | null>(null);
  const type: DocType | null = loaded?.doc_type ?? docQ.data?.doc_type ?? newType;
  const cfg = type ? DOC_TYPES[type] : null;

  const [header, setHeader] = useState<HeaderDraft>(() => ({
    doc_date: todayVn(),
    partner: null,
    warehouse_id: null,
    to_warehouse_id: null,
    note: '',
  }));
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [editing, setEditing] = useState(docId === null);
  const [saving, setSaving] = useState(false);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({});
  const [remote, setRemote] = useState<{ by: string; at: string } | null>(null);
  const [deletedBy, setDeletedBy] = useState<string | null>(null);
  const [stash, setStash] = useState<LineChange[] | null>(null);
  const baseLinesRef = useRef<LineDraft[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printSize, setPrintSize] = useState<'A4' | 'A5'>('A4');
  const [focusReq, setFocusReq] = useState<{ key: string; col: Col; n: number } | null>(null);
  const [showNoteSetting, setShowNote] = useState(() => storage.get(NOTE_KEY) === '1');
  const showNote = showNoteSetting || lines.some((l) => l.note.trim());
  const drawers = useDrawers();
  const location = useLocation();
  const skipGuard = useRef(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const partnerRef = useRef<{ focus: () => void } | null>(null);
  const whRef = useRef<{ focus: () => void } | null>(null);
  const noteRef = useRef<InputRef>(null);

  const warehouses = useWarehouses();
  const whItems: Warehouse[] = warehouses.data?.items ?? [];

  // ---------- nạp phiếu ----------
  const load = useCallback(
    (d: DocumentFull) => {
      const dr = draftFromDoc(d);
      setHeader(dr.header);
      setLines(dr.lines);
      baseLinesRef.current = dr.lines;
      setLoaded(d);
      setBaseline(fingerprint(d.doc_type, dr.header, dr.lines));
      setEditing(d.status === 'draft');
      setLineErrors({});
      setHeaderErrors({});
      setRemote(null);
      qc.setQueryData(qk.document(d.id), d);
      void qc.invalidateQueries({ queryKey: ['document', d.id, 'check'] });
    },
    [qc],
  );

  const isNew = docId === null && !loaded;
  const readOnlyBase = !editing || !!deletedBy;
  const fp = type ? fingerprint(type, header, lines) : '';
  const dirty = isNew
    ? sentLines(lines).length > 0 || !!header.partner || !!header.note.trim()
    : editing && baseline !== null && fp !== baseline;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  // bản mới nhất cho các thao tác gọi lại từ hộp thoại (tránh dùng giá trị cũ trong closure)
  const loadedRef = useRef<DocumentFull | null>(null);
  loadedRef.current = loaded;

  // Kho mặc định cho phiếu mới: kho dùng lần trước trên máy này, hoặc kho đầu tiên.
  useEffect(() => {
    if (!isNew || header.warehouse_id !== null || !whItems.length) return;
    const last = Number(storage.get(`${LAST_WH}.${type}`));
    const def = whItems.find((w) => w.active && w.id === last) ?? whItems.find((w) => w.active);
    if (def) setHeader((h) => ({ ...h, warehouse_id: def.id }));
  }, [isNew, header.warehouse_id, whItems]);

  // Phiếu mới điền sẵn (vd. từ "Hàng cần đặt"): lấy mã, ĐVT, giá mặc định bằng một lần gọi
  const prefilled = useRef(false);
  useEffect(() => {
    const st = location.state as { prefill?: { lines: { product_id: number; qty: number }[]; note?: string } } | null;
    if (!isNew || prefilled.current || !st?.prefill?.lines.length || !cfg) return;
    prefilled.current = true;
    const pre = st.prefill;
    void productsApi
      .priceInfoBatch(pre.lines.map((l) => l.product_id))
      .then((r) => {
        const byId = new Map(r.items.map((p) => [p.product_id, p]));
        const ls: LineDraft[] = pre.lines.flatMap((l) => {
          const p = byId.get(l.product_id);
          if (!p) return [];
          return [
            {
              ...emptyLine(),
              product: { id: p.product_id, code: p.code, name: p.name, unit: p.unit, is_service: p.is_service, sale_price: p.sale_price, purchase_price: p.purchase_price },
              codeText: p.code,
              unit: p.unit,
              qty: l.qty,
              unit_price: cfg.defaultPrice ? p[cfg.defaultPrice] : null,
            },
          ];
        });
        setLines(withTrailingBlank(ls));
        if (pre.note) setHeader((h) => ({ ...h, note: pre.note ?? '' }));
        message.info(`Đã điền sẵn ${ls.length} mã thiếu — chọn nhà cung cấp rồi lưu`, 3);
      })
      .catch((e: unknown) => message.error(errorMessage(e)));
  }, [isNew, cfg, location.state, message]);

  // Dữ liệu máy chủ đổi (máy khác sửa / ghi sổ, hoặc SSE làm mới)
  useEffect(() => {
    const d = docQ.data;
    if (!d) return;
    if (!loaded) {
      load(d);
      return;
    }
    if (d.id !== loaded.id || d.version === loaded.version) return;
    if (!dirtyRef.current) {
      load(d);
      if (d.updated_by !== me.id) message.info(`Phiếu vừa được ${d.updated_by_name} cập nhật lúc ${formatDateTime(d.updated_at).slice(11)} — đã hiện bản mới nhất`, 3);
    } else if (d.updated_by !== me.id) {
      setRemote({ by: d.updated_by_name, at: d.updated_at });
    }
  }, [docQ.data, loaded, load, me.id, message]);

  useServerEvent((e) => {
    if (e.type === 'document.changed' && loaded && e.id === loaded.id && e.action === 'deleted' && e.by_id !== me.id) setDeletedBy(e.by);
  });

  // Con trỏ ban đầu
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (docId === null) {
        if (cfg?.partner) partnerRef.current?.focus();
        else whRef.current?.focus();
      }
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!loaded || focusedOnce.current || loaded.status !== 'draft') return;
    focusedOnce.current = true;
    const last = lines[lines.length - 1];
    if (last) setFocusReq({ key: last.key, col: 'code', n: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // ---------- giá, tồn: MỘT lần gọi cho cả phiếu ----------
  const dateStr = toApiDate(header.doc_date);
  const productIds = useMemo(
    () => [...new Set(lines.filter((l) => l.product && !l.product.is_service).map((l) => l.product!.id))].sort((x, y) => x - y),
    [lines],
  );
  const piQ = useQuery({
    queryKey: ['price-info', 'batch', productIds.join(','), dateStr ?? '', header.warehouse_id ?? 0],
    queryFn: () => productsApi.priceInfoBatch(productIds, dateStr, header.warehouse_id),
    enabled: productIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const piMap = useMemo(() => {
    const m = new Map<number, PriceInfoWh>();
    for (const it of piQ.data?.items ?? []) m.set(it.product_id, it);
    return m;
  }, [piQ.data]);

  // ---------- kiểm tra tồn / bán lỗ của nội dung ĐANG GÕ (máy chủ tính, kể cả xung đột các ngày sau) ----------
  const checkBody = useMemo(() => {
    if (!type || !cfg || readOnlyBase) return null;
    const b = toBody(type, header, lines.filter((l) => l.product));
    if (!b.lines.some((l) => l.qty) || !b.warehouse_id || !b.doc_date) return null;
    if (cfg.partner && !b.partner_id) return null;
    if (cfg.toWarehouse && !b.to_warehouse_id) return null;
    return JSON.stringify({ ...b, id: loaded?.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp, type, loaded?.id, readOnlyBase]);
  const checkKey = useDebounced(checkBody, 450);
  const liveCheck = useQuery({
    queryKey: ['document-check', checkKey],
    queryFn: ({ signal }) => documentsApi.checkDraft(JSON.parse(checkKey ?? '{}') as Parameters<typeof documentsApi.checkDraft>[0], signal),
    enabled: !!checkKey,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 10_000,
  });
  const check = checkBody ? liveCheck.data : undefined;

  const hints = useMemo(() => {
    const out: Record<string, LineHint> = {};
    if (!cfg) return out;
    const withProduct = lines.filter((l) => l.product);
    for (const l of lines) {
      const h: LineHint = {};
      if (lineErrors[l.key]) h.error = lineErrors[l.key];
      const p = l.product;
      if (p && !p.is_service) {
        const pi = piMap.get(p.id);
        if (cfg.lossCheck && pi && pi.cost_source !== 'none' && l.unit_price !== null && l.unit_price < pi.cost_price) h.loss = pi.cost_price;
        const sh = check?.stock_shortages.find((s) => s.product_id === p.id);
        if (sh && editing) h.shortage = { short: sh.shortage, available: sh.available, required: sh.required, date: sh.date, message: sh.message, docDate: dateStr };
      }
      if (h.error || h.loss !== undefined || h.shortage) out[l.key] = h;
    }
    for (const w of check?.loss_lines ?? []) {
      const l = withProduct[w.line_no - 1];
      if (l && out[l.key]?.loss === undefined) out[l.key] = { ...(out[l.key] ?? {}), loss: w.cost_price };
    }
    return out;
  }, [lines, cfg, editing, lineErrors, piMap, check, dateStr]);

  const liveTotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const goodsQty = lines.filter((l) => l.product && !l.product.is_service).reduce((s, l) => s + (l.qty ?? 0), 0);
  const lineCount = sentLines(lines).length;

  // ---------- chặn rời trang khi chưa lưu ----------
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !skipGuard.current &&
      dirtyRef.current &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  const blockerShown = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || blockerShown.current) return;
    blockerShown.current = true;
    modal.confirm({
      title: 'Phiếu chưa lưu',
      content: 'Bạn có thay đổi chưa lưu. Rời khỏi phiếu bây giờ sẽ mất các thay đổi này.',
      okText: 'Bỏ thay đổi, rời đi',
      okButtonProps: { danger: true },
      cancelText: 'Ở lại phiếu',
      autoFocusButton: 'cancel',
      onOk: () => {
        blockerShown.current = false;
        blocker.proceed?.();
      },
      onCancel: () => {
        blockerShown.current = false;
        blocker.reset?.();
      },
    });
  }, [blocker, modal]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // ---------- hộp thoại lỗi ----------
  const showShortage = (items: Shortage[], ctx: 'post' | 'save' | 'unpost') => {
    modal.error({
      title: ctx === 'unpost' ? 'Không bỏ ghi sổ được — sẽ làm âm kho' : 'Không đủ hàng trong kho',
      width: 620,
      okText: 'Đã hiểu',
      content: (
        <>
          <ul className="dlg-list">
            {items.map((s, i) => (
              <li key={i}>{s.message}</li>
            ))}
          </ul>
          {ctx === 'post' && (
            <div className="dlg-hint">
              Phiếu <b>vẫn được giữ là Phiếu tạm</b> (đã lưu, không mất gì) và hiện trong <b>Mua hàng › Hàng cần đặt</b> để kế
              toán mua đặt hàng. Khi hàng về (ghi sổ phiếu nhập), mở lại phiếu này và bấm Ghi sổ.
            </div>
          )}
          {ctx === 'save' && <div className="dlg-hint">Phiếu đã ghi sổ <b>chưa bị thay đổi</b>. Hãy giảm số lượng hoặc nhập thêm hàng trước.</div>}
          {ctx === 'unpost' && <div className="dlg-hint">Các phiếu xuất sau đó đang dùng số hàng của phiếu này. Phiếu vẫn ở trạng thái đã ghi sổ.</div>}
        </>
      ),
    });
  };

  const confirmLoss = (items: LossWarning[], onOk: () => void, verb: string) => {
    modal.confirm({
      title: 'Có dòng bán thấp hơn giá mua (bán lỗ)',
      width: 600,
      content: (
        <>
          <ul className="dlg-list">
            {items.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
          <div className="dlg-hint">Kiểm tra lại đơn giá. Nếu đúng là bán giá này, bấm “{verb}”.</div>
        </>
      ),
      okText: verb,
      okButtonProps: { danger: true },
      cancelText: 'Xem lại giá',
      autoFocusButton: 'cancel',
      onOk,
    });
  };

  const reloadKeepingMine = async () => {
    // chỉ giữ phần máy này đã thêm / sửa / xóa kể từ lúc nạp (F-01) — dòng không đổi thì không lặp lại
    const mine = diffLines(baseLinesRef.current, lines);
    setStash(mine.length ? mine : null);
    if (!loaded) return;
    try {
      const fresh = await documentsApi.get(loaded.id);
      load(fresh);
    } catch (e) {
      modal.error({ title: 'Không tải được phiếu', content: errorMessage(e) });
    }
  };

  const showConflict = (d: VersionConflictDetails | null) => {
    modal.confirm({
      title: 'Máy khác vừa sửa phiếu này',
      width: 560,
      content: (
        <>
          <p>
            <b>{d?.updated_by ?? 'Một người khác'}</b> đã lưu phiếu lúc {d ? formatDateTime(d.updated_at) : '…'}, sau khi bạn mở phiếu.
            Phần bạn vừa sửa <b>chưa được lưu</b> để không ghi đè lên bản của họ.
          </p>
          <p>
            Bấm <b>Tải bản mới</b> để xem bản mới nhất. Các dòng bạn đã nhập vẫn được giữ trong khung vàng phía trên để đối chiếu, chép
            hoặc thêm lại vào phiếu.
          </p>
        </>
      ),
      okText: 'Tải bản mới',
      cancelText: 'Để tôi xem lại',
      onOk: () => reloadKeepingMine(),
    });
  };

  const handleError = (e: unknown, ctx: 'save' | 'post' | 'unpost' | 'delete', sent: LineDraft[], retryWithLoss?: () => void) => {
    if (!(e instanceof ApiError)) {
      modal.error({ title: 'Có lỗi', content: errorMessage(e) });
      return;
    }
    switch (e.code) {
      case 'VERSION_CONFLICT':
        showConflict(e.details as VersionConflictDetails | null);
        return;
      case 'LOSS_WARNING':
        if (retryWithLoss) confirmLoss((e.details as LossWarning[] | null) ?? [], retryWithLoss, ctx === 'post' ? 'Vẫn ghi sổ' : 'Vẫn lưu');
        return;
      case 'INSUFFICIENT_STOCK':
        showShortage((e.details as Shortage[] | null) ?? [], ctx === 'delete' ? 'save' : ctx);
        return;
      case 'IN_USE':
        modal.error({
          title: 'Không xóa được phiếu',
          content: (
            <>
              <p>{e.message}</p>
              <div className="dlg-hint">Mở phiếu thu/chi đó, bỏ liên kết tới phiếu này rồi xóa lại.</div>
            </>
          ),
        });
        return;
      case 'NOT_FOUND':
        modal.error({ title: 'Không tìm thấy phiếu', content: 'Phiếu này không còn — có thể máy khác vừa xóa. Hãy quay lại danh sách.' });
        return;
      case 'VALIDATION': {
        const ln = e.lineNo;
        const target = ln !== undefined ? sent[ln - 1] : undefined;
        if (target) {
          setLineErrors({ [target.key]: e.message });
          const col: Col = e.field === 'unit_price' ? 'price' : e.field === 'qty' ? 'qty' : 'code';
          setFocusReq({ key: target.key, col, n: Date.now() });
        } else if (e.field) {
          setHeaderErrors({ [e.field]: e.message });
        }
        message.error(e.message, 4);
        return;
      }
      default:
        modal.error({ title: 'Không thực hiện được', content: e.message });
    }
  };

  // ---------- lưu ----------
  const save = async (opts: { confirmLoss?: boolean; quiet?: boolean } = {}): Promise<DocumentFull | null> => {
    if (!type || !cfg || saving) return null;
    const sent = sentLines(lines);
    setLineErrors({});
    setHeaderErrors({});
    const unresolved = sent.find((l) => !l.product);
    if (unresolved) {
      setLineErrors({ [unresolved.key]: `Mã "${unresolved.codeText.trim()}" chưa có trong danh mục — chọn lại mã hoặc xóa dòng` });
      setFocusReq({ key: unresolved.key, col: 'code', n: Date.now() });
      message.error('Có dòng chưa chọn được mã hàng', 3);
      return null;
    }
    const hErr: Record<string, string> = {};
    if (!header.doc_date) hErr.doc_date = 'Nhập ngày hạch toán';
    if (cfg.partner && !header.partner) hErr.partner_id = `Chọn ${cfg.partnerLabel.toLowerCase()}`;
    if (!header.warehouse_id) hErr.warehouse_id = 'Chọn kho';
    if (cfg.toWarehouse && !header.to_warehouse_id) hErr.to_warehouse_id = 'Chọn kho nhận';
    if (Object.keys(hErr).length) {
      setHeaderErrors(hErr);
      message.error(Object.values(hErr)[0], 3);
      if (hErr.partner_id) partnerRef.current?.focus();
      return null;
    }
    const body = toBody(type, header, lines);
    setSaving(true);
    try {
      const d = loaded
        ? await documentsApi.update(loaded.id, { ...body, version: loaded.version, confirm_loss: opts.confirmLoss ?? false })
        : await documentsApi.create(body);
      if (header.warehouse_id) storage.set(`${LAST_WH}.${type}`, String(header.warehouse_id));
      const wasNew = !loaded;
      load(d);
      if (wasNew) {
        onCreated(d.id);
        skipGuard.current = true;
        navigate(paths.document(d.id), { replace: true });
        window.setTimeout(() => (skipGuard.current = false), 0);
      }
      if (!opts.quiet)
        message.success(
          d.status === 'posted' ? `Đã lưu thay đổi phiếu ${d.doc_no} — tồn kho, công nợ đã tính lại` : `Đã lưu phiếu tạm ${d.draft_no}`,
          2,
        );
      void qc.invalidateQueries({ queryKey: qk.documents });
      return d;
    } catch (e) {
      handleError(e, 'save', sent, () => void save({ ...opts, confirmLoss: true }));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const post = async (confirm = false) => {
    if (!cfg) return;
    let d = loadedRef.current;
    if (!d || dirtyRef.current) {
      d = await save({ quiet: true });
      if (!d) return;
    }
    if (d.status === 'posted') return;
    setSaving(true);
    try {
      const r = await documentsApi.post(d.id, d.version, confirm);
      load(r);
      message.success(`Đã ghi sổ — số phiếu ${r.doc_no}`, 2.5);
      void qc.invalidateQueries({ queryKey: qk.documents });
    } catch (e) {
      // lỗi khi ghi sổ: phiếu vẫn đã lưu tạm ⇒ cập nhật version mới nhất
      handleError(e, 'post', sentLines(lines), () => void post(true));
    } finally {
      setSaving(false);
    }
  };

  const unpost = () => {
    if (!loaded) return;
    modal.confirm({
      title: `Bỏ ghi sổ phiếu ${loaded.doc_no}?`,
      content: (
        <>
          Phiếu trở về <b>Phiếu tạm</b>: tồn kho và công nợ không còn tính phiếu này cho tới khi ghi sổ lại. Số {loaded.doc_no} được giữ
          nguyên để ghi sổ lại.
        </>
      ),
      okText: 'Bỏ ghi sổ',
      okButtonProps: { danger: true },
      cancelText: 'Không',
      autoFocusButton: 'cancel',
      onOk: async () => {
        try {
          const r = await documentsApi.unpost(loaded.id, loaded.version);
          load(r);
          message.success(`Đã bỏ ghi sổ — phiếu ${r.doc_no} trở về phiếu tạm`, 2);
        } catch (e) {
          handleError(e, 'unpost', []);
        }
      },
    });
  };

  const remove = () => {
    if (!loaded || !cfg) return;
    modal.confirm({
      title: `Xóa phiếu tạm ${loaded.draft_no}?`,
      content: 'Xóa xong không khôi phục được (lịch sử vẫn lưu lại).',
      okText: 'Xóa phiếu',
      okButtonProps: { danger: true },
      cancelText: 'Không xóa',
      autoFocusButton: 'cancel',
      onOk: async () => {
        try {
          await documentsApi.remove(loaded.id, loaded.version);
          message.success(`Đã xóa phiếu tạm ${loaded.draft_no}`, 2);
          skipGuard.current = true;
          void qc.invalidateQueries({ queryKey: qk.documents });
          navigate(cfg.listPath);
        } catch (e) {
          handleError(e, 'delete', []);
        }
      },
    });
  };

  const cancelEdit = () => {
    if (!loaded) return;
    const doIt = () => load(loaded);
    if (dirty)
      modal.confirm({
        title: 'Bỏ các thay đổi?',
        content: 'Phiếu trở lại như lúc chưa sửa.',
        okText: 'Bỏ thay đổi',
        cancelText: 'Tiếp tục sửa',
        onOk: doIt,
      });
    else doIt();
  };

  const needSavedFirst = (what: string): boolean => {
    if (!loaded) {
      message.warning(`Lưu phiếu trước khi ${what}`, 2.5);
      return true;
    }
    if (dirty) {
      message.warning(`Phiếu có thay đổi chưa lưu — bấm Lưu (Ctrl+S) trước khi ${what}`, 3);
      return true;
    }
    return false;
  };
  const openPrint = () => {
    if (!needSavedFirst('in')) setPrintOpen(true);
  };
  const exportFile = (f: 'xlsx' | 'docx') => {
    if (loaded && !needSavedFirst('xuất file')) download(documentsApi.exportUrl(loaded.id, f));
  };

  const readOnly = readOnlyBase;
  const canPost = !readOnly && (!loaded || loaded.status === 'draft');

  useHotkeys({
    'Ctrl+s': () => {
      if (!readOnly) void save();
    },
    F9: () => {
      if (canPost) void post();
    },
    F8: () => {
      if (loaded?.status === 'posted' && !editing) setEditing(true);
    },
    'Ctrl+p': () => openPrint(),
    F2: () => {
      if (type) navigate(paths.newDocument(type));
    },
  });

  const partnerSide = cfg?.partner === 'supplier' ? 'payable' : 'receivable';
  const partnerDebt = useQuery({
    queryKey: qk.report('debt-ledger', { partner_id: header.partner?.id, side: partnerSide }),
    queryFn: () => reportApi.debtLedger({ partner_id: header.partner!.id, side: partnerSide }),
    enabled: !!header.partner && !!cfg?.partner,
    staleTime: 15_000,
  });

  useMenuHighlight(
    cfg?.listPath ?? null,
    cfg ? `${cfg.name}${loaded ? ` ${loaded.doc_no ?? loaded.draft_no}` : ' (mới)'}` : 'Chứng từ',
  );

  // ---------- giao diện ----------
  if (docId !== null && docQ.isError && !loaded) {
    const nf = docQ.error instanceof ApiError && docQ.error.status === 404;
    return (
      <Result
        status={nf ? '404' : 'error'}
        title={nf ? 'Không tìm thấy phiếu' : 'Không tải được phiếu'}
        subTitle={nf ? 'Phiếu không còn — có thể đã bị xóa.' : errorMessage(docQ.error)}
        extra={<Button onClick={() => navigate(-1)}>Quay lại</Button>}
      />
    );
  }
  if (!cfg || !type || (docId !== null && !loaded)) return <Skeleton active paragraph={{ rows: 10 }} />;

  const whOptions = whItems.map((w) => ({
    value: w.id,
    label: `${w.code} – ${w.name}`,
    disabled: !w.active && w.id !== loaded?.warehouse_id && w.id !== loaded?.to_warehouse_id,
  }));
  const oldDebt = loaded?.old_debt ?? null;

  const field = (label: string, err: string | undefined, node: ReactNode, cls = '') => (
    <div className={`hf ${cls}${err ? ' hf-err' : ''}`}>
      <label>{label}</label>
      {node}
      {err && <div className="hf-msg">{err}</div>}
    </div>
  );

  const stashText = (stash ?? [])
    .map((c) => [CHANGE_LABEL[c.kind], c.line.product?.code ?? '', c.line.product?.is_service ? c.line.description : (c.line.product?.name ?? ''), c.line.qty ?? '', c.line.unit_price ?? ''].join('\t'))
    .join('\n');

  return (
    <div className="doc-editor">
      {/* ---------- thanh trên ---------- */}
      <div className="doc-top">
        <Tooltip title="Về danh sách">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(cfg.listPath)} aria-label="Về danh sách" />
        </Tooltip>
        <div className="doc-title">
          <h2>{cfg.name}</h2>
          <div className="doc-no">
            {loaded ? (
              loaded.doc_no ? (
                <>
                  Số <b>{loaded.doc_no}</b>
                  <span className="muted"> (số tạm {loaded.draft_no})</span>
                </>
              ) : (
                <Tooltip title="Số chính thức (XK…, NK…) được cấp khi ghi sổ">
                  Số tạm <b>{loaded.draft_no}</b>
                </Tooltip>
              )
            ) : (
              <span className="muted">Số tạm cấp khi lưu</span>
            )}
          </div>
        </div>
        <StatusBadge doc={loaded} editing={editing} isNew={isNew} />
        <div className="doc-actions">
          {!readOnly && (
            <Button icon={<SaveOutlined />} onClick={() => void save()} loading={saving} type={loaded?.status === 'posted' ? 'primary' : 'default'}>
              {loaded?.status === 'posted' ? 'Lưu thay đổi' : 'Lưu tạm'} <Kbd>Ctrl+S</Kbd>
            </Button>
          )}
          {canPost && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void post()} loading={saving}>
              Ghi sổ <Kbd>F9</Kbd>
            </Button>
          )}
          {loaded?.status === 'posted' && editing && !deletedBy && <Button onClick={cancelEdit}>Hủy sửa</Button>}
          {loaded?.status === 'posted' && !editing && (
            <>
              <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>
                Sửa phiếu <Kbd>F8</Kbd>
              </Button>
              {(type === 'sale' || type === 'purchase') && (
                <Button icon={<DollarOutlined />} onClick={() => loaded && navigate(paths.newVoucher(type === 'sale' ? 'receipt' : 'payment', { document_id: loaded.id }))}>
                  {type === 'sale' ? 'Thu tiền phiếu này' : 'Chi tiền phiếu này'}
                </Button>
              )}
              <Button icon={<RollbackOutlined />} onClick={unpost}>
                Bỏ ghi sổ
              </Button>
            </>
          )}
          <Dropdown.Button
            icon={<span className="dd-caret">▾</span>}
            onClick={openPrint}
            disabled={!loaded}
            menu={{
              items: [
                { key: 'xlsx', icon: <FileExcelOutlined />, label: 'Xuất Excel (.xlsx)' },
                { key: 'docx', icon: <FileWordOutlined />, label: 'Xuất Word (.docx)' },
              ],
              onClick: ({ key }) => exportFile(key === 'docx' ? 'docx' : 'xlsx'),
            }}
          >
            <PrinterOutlined /> In
          </Dropdown.Button>
          {loaded && (
            <Tooltip title="Lịch sử sửa phiếu">
              <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)} aria-label="Lịch sử sửa phiếu" />
            </Tooltip>
          )}
          {loaded?.status === 'draft' && (
            <Tooltip title="Xóa phiếu tạm">
              <Button danger icon={<DeleteOutlined />} onClick={remove} aria-label="Xóa phiếu tạm" />
            </Tooltip>
          )}
        </div>
      </div>
      {loaded && (
        <div className="doc-meta">
          Lập: {loaded.created_by_name} {formatDateTime(loaded.created_at)} · Sửa lần cuối: <b>{loaded.updated_by_name}</b>{' '}
          {formatDateTime(loaded.updated_at)}
          {loaded.posted_at && (
            <>
              {' '}
              · Ghi sổ: {loaded.posted_by_name} {formatDateTime(loaded.posted_at)}
            </>
          )}
        </div>
      )}

      {deletedBy && <Alert type="error" showIcon message={`Phiếu này vừa bị ${deletedBy} xóa. Không lưu được nữa — hãy quay lại danh sách.`} className="doc-alert" />}
      {remote && !deletedBy && (
        <Alert
          className="doc-alert"
          type="warning"
          showIcon
          message={`Phiếu vừa được ${remote.by} sửa lúc ${formatDateTime(remote.at)}. Bạn đang có thay đổi chưa lưu trên máy này.`}
          action={
            <Space>
              <Button size="small" type="primary" onClick={() => void reloadKeepingMine()}>
                Tải bản mới
              </Button>
              <Button size="small" onClick={() => setRemote(null)}>
                Để sau
              </Button>
            </Space>
          }
        />
      )}
      {stash && (
        <Alert
          className="doc-alert"
          type="warning"
          message={`Các dòng bạn đã nhập trước khi tải bản mới (${stash.length} thay đổi của máy này, chưa lưu)`}
          description={
            <div>
              <table className="stash-table">
                <tbody>
                  {stash.map((c) => (
                    <tr key={c.line.key}>
                      <td>
                        <Tag color={c.kind === 'added' ? 'blue' : c.kind === 'edited' ? 'orange' : 'red'}>{CHANGE_LABEL[c.kind]}</Tag>
                      </td>
                      <td>{c.line.product?.code}</td>
                      <td>{c.line.product?.is_service ? c.line.description : c.line.product?.name}</td>
                      <td className="num">
                        {c.kind === 'edited' && c.before && c.before.qty !== c.line.qty ? (
                          <>
                            SL {formatQty(c.before.qty)} → <b>{formatQty(c.line.qty)}</b>
                          </>
                        ) : (
                          formatQty(c.line.qty)
                        )}
                      </td>
                      <td className="num">
                        {c.kind === 'edited' && c.before && c.before.unit_price !== c.line.unit_price ? (
                          <>
                            giá {formatMoney(c.before.unit_price)} → <b>{formatMoney(c.line.unit_price)}</b>
                          </>
                        ) : c.line.unit_price === null ? (
                          ''
                        ) : (
                          formatMoney(c.line.unit_price)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Space style={{ marginTop: 6 }}>
                {!readOnly && (
                  <Button
                    size="small"
                    onClick={() => {
                      setLines((ls) => applyChanges(ls, stash));
                      setStash(null);
                    }}
                  >
                    Thêm các dòng này vào phiếu
                  </Button>
                )}
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => void navigator.clipboard?.writeText(stashText).then(() => message.success('Đã chép — dán được vào Excel', 1.5))}
                >
                  Chép
                </Button>
                <Button size="small" onClick={() => setStash(null)}>
                  Ẩn
                </Button>
              </Space>
            </div>
          }
        />
      )}

      {/* ---------- đầu phiếu ---------- */}
      <div className="doc-header" data-enter-scope ref={headerRef} onKeyDownCapture={readOnly ? undefined : enterToNext(() => {
        const first = lines.find((l) => isBlank(l)) ?? lines[0];
        if (first) setFocusReq({ key: first.key, col: 'code', n: Date.now() });
      })}>
        {readOnly ? (
          <>
            {field('Ngày hạch toán', undefined, <div className="ro-val">{formatDate(loaded?.doc_date)}</div>, 'hf-date')}
            {cfg.partner &&
              field(
                cfg.partnerLabel,
                undefined,
                <div className="ro-val">
                  <b>{loaded?.partner_name}</b> <span className="muted">{loaded?.partner_code}</span>
                </div>,
                'hf-partner',
              )}
            {field(cfg.warehouseLabel, undefined, <div className="ro-val">{loaded?.warehouse_name}</div>, 'hf-wh')}
            {cfg.toWarehouse && field('Kho nhận', undefined, <div className="ro-val">{loaded?.to_warehouse_name}</div>, 'hf-wh')}
            {field('Ghi chú', undefined, <div className="ro-val">{loaded?.note || <span className="muted">—</span>}</div>, 'hf-note')}
          </>
        ) : (
          <>
            {field(
              'Ngày hạch toán',
              headerErrors.doc_date,
              <DateInput id="doc_date" value={header.doc_date} onChange={(d) => setHeader((h) => ({ ...h, doc_date: d }))} />,
              'hf-date',
            )}
            {cfg.partner &&
              field(
                cfg.partnerLabel,
                headerErrors.partner_id,
                <PartnerSelect
                  ref={(r) => (partnerRef.current = r)}
                  id="partner"
                  type={cfg.partner}
                  value={header.partner?.id ?? null}
                  current={header.partner}
                  status={headerErrors.partner_id ? 'error' : undefined}
                  onChange={(p) => {
                    setHeader((h) => ({ ...h, partner: p }));
                    setHeaderErrors((e) => ({ ...e, partner_id: '' }));
                  }}
                />,
                'hf-partner',
              )}
            {field(
              cfg.warehouseLabel,
              headerErrors.warehouse_id,
              <Select<number>
                ref={(r) => (whRef.current = r)}
                id="warehouse"
                value={header.warehouse_id ?? undefined}
                options={whOptions}
                showSearch
                filterOption={filterByLabel}
                onChange={(v) => setHeader((h) => ({ ...h, warehouse_id: v }))}
                status={headerErrors.warehouse_id ? 'error' : undefined}
              />,
              'hf-wh',
            )}
            {cfg.toWarehouse &&
              field(
                'Kho nhận',
                headerErrors.to_warehouse_id,
                <Select<number>
                  id="to_warehouse"
                  value={header.to_warehouse_id ?? undefined}
                  options={whOptions.map((o) => ({ ...o, disabled: o.disabled || o.value === header.warehouse_id }))}
                  showSearch
                  filterOption={filterByLabel}
                  placeholder="Chọn kho nhận"
                  onChange={(v) => setHeader((h) => ({ ...h, to_warehouse_id: v }))}
                  status={headerErrors.to_warehouse_id ? 'error' : undefined}
                />,
                'hf-wh',
              )}
            {field(
              'Ghi chú',
              headerErrors.note,
              <Input ref={noteRef} id="note" value={header.note} maxLength={500} onChange={(e) => setHeader((h) => ({ ...h, note: e.target.value }))} />,
              'hf-note',
            )}
          </>
        )}
        {cfg.partner && header.partner && (
          <div className="hf-partner-info muted">
            {header.partner.address}
            {header.partner.phone && <> · ĐT {header.partner.phone}</>}
            {partnerDebt.data && (
              <span className="partner-debt">
                {' '}
                · {cfg.partner === 'customer' ? 'Khách đang nợ' : 'Mình đang nợ'}:{' '}
                <b className={partnerDebt.data.closing > 0 ? 'neg' : undefined}>{formatMoney(partnerDebt.data.closing)} đ</b>{' '}
                <Button
                  type="link"
                  size="small"
                  className="link-cell"
                  tabIndex={-1}
                  onClick={() =>
                    header.partner &&
                    drawers.push({
                      kind: 'debt',
                      partner: { id: header.partner.id, code: header.partner.code, name: header.partner.name },
                      side: cfg.partner === 'customer' ? 'receivable' : 'payable',
                    })
                  }
                >
                  Xem công nợ
                </Button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ---------- dòng hàng ---------- */}
      <div className="doc-body">
        <LineGrid
          cfg={cfg}
          lines={lines}
          onChange={(ls) => {
            setLines(ls);
            if (Object.keys(lineErrors).length) setLineErrors({});
          }}
          readOnly={readOnly}
          warehouseId={header.warehouse_id}
          priceInfo={(id) => piMap.get(id)}
          showNote={showNote}
          onToggleNote={(v) => {
            setShowNote(v);
            storage.set(NOTE_KEY, v ? '1' : '0');
          }}
          onShowLedger={(p) => drawers.push({ kind: 'ledger', product: { id: p.id, code: p.code, name: p.name, unit: p.unit }, warehouseId: header.warehouse_id ?? undefined })}
          onShowHistory={(p) =>
            drawers.push({ kind: 'trade', report: type.startsWith('purchase') ? 'purchases' : 'sales', product: { id: p.id, code: p.code, name: p.name, unit: p.unit } })
          }
          hints={hints}
          focusRequest={focusReq}
        />
      </div>

      {/* ---------- chân phiếu ---------- */}
      <div className="doc-footer">
        <div className="doc-check">
          {!readOnly && check && (
            check.stock_shortages.length ? (
              <div className="check-bad">
                <b>{loaded?.status === 'posted' ? 'Lưu thay đổi này sẽ làm thiếu hàng:' : 'Chưa ghi sổ được — thiếu hàng:'}</b>
                <ul>
                  {check.stock_shortages.map((s, i) => (
                    <li key={i} title={s.message}>
                      {s.required === 0 ? (
                        s.message
                      ) : (
                        <>
                          {s.product_code} tại {s.warehouse_name}
                          {s.date !== dateStr && <> ngày {formatDate(s.date)}</>}: tồn {formatQty(s.available)}, cần {formatQty(s.required)}, thiếu{' '}
                          <b>{formatQty(s.shortage)}</b>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : check.can_post ? (
              <div className="check-ok">✓ Đủ hàng — {loaded?.status === 'posted' ? 'lưu được' : 'ghi sổ được'}</div>
            ) : null
          )}
          {dirty && <div className="muted">Có thay đổi chưa lưu</div>}
          {readOnly && loaded?.status === 'posted' && (
            <div className="muted">
              Phiếu đã ghi sổ: tồn kho và công nợ đã tính. Bấm <b>Sửa phiếu</b> (F8) nếu cần sửa — máy sẽ kiểm tra lại tồn kho.
            </div>
          )}
        </div>
        <div className="doc-sums">
          <div>
            <span>Số dòng</span>
            <b>{lineCount}</b>
          </div>
          <div>
            <span>Tổng SL hàng</span>
            <b>{formatQty(goodsQty)}</b>
          </div>
          {cfg.hasPrice && (
            <div className="sum-main">
              <span>Cộng</span>
              <b>{formatMoney(liveTotal)}</b>
            </div>
          )}
          {cfg.hasDebt && (
            <>
              <div>
                <span>Nợ cũ</span>
                <b>{oldDebt === null ? <span className="muted">tính khi lưu</span> : formatMoney(oldDebt)}</b>
              </div>
              <div className="sum-main">
                <span>
                  Tổng nợ{header.doc_date ? ` đến ${header.doc_date.format('DD/MM/YYYY')}` : ''}
                  {dirty && oldDebt !== null && <span className="muted"> (tạm tính)</span>}
                </span>
                <b>{oldDebt === null ? '—' : formatMoney(oldDebt + liveTotal)}</b>
              </div>
            </>
          )}
        </div>
      </div>

      {loaded && <HistoryDrawer id={loaded.id} open={historyOpen} onClose={() => setHistoryOpen(false)} />}

      {/* ---------- in ---------- */}
      {loaded && printOpen && (
        <>
          <Modal
            open
            width={880}
            title={loaded.status === 'draft' ? 'Xem trước bản in — PHIẾU TẠM' : 'Xem trước bản in'}
            onCancel={() => setPrintOpen(false)}
            footer={
              <Space>
                <span className="muted">Khổ giấy</span>
                <Segmented<'A4' | 'A5'> value={printSize} onChange={setPrintSize} options={['A4', 'A5']} />
                <Button onClick={() => setPrintOpen(false)}>Đóng</Button>
                <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} autoFocus>
                  In
                </Button>
              </Space>
            }
          >
            {loaded.status === 'draft' && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 10 }}
                message="Phiếu chưa ghi sổ nên chỉ in được dạng PHIẾU TẠM. Phiếu chính thức in được sau khi ghi sổ (đủ hàng trong kho)."
              />
            )}
            <div className={`print-preview size-${printSize}`}>
              <PrintSheet doc={loaded} />
            </div>
          </Modal>
          {createPortal(
            <div id="print-root" className={`size-${printSize}`}>
              <style>{`@page { size: ${printSize} portrait; margin: ${printSize === 'A5' ? 8 : 12}mm; }`}</style>
              <PrintSheet doc={loaded} />
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}
