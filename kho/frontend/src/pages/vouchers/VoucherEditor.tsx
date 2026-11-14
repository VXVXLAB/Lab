import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { filterByLabel } from '../../lib/text';
import { createPortal } from 'react-dom';
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Drawer, Dropdown, Input, Modal, Radio, Result, Segmented, Select, Skeleton, Space, Timeline, Tooltip, Tag } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, FileExcelOutlined, FileWordOutlined, HistoryOutlined, PlusOutlined, PrinterOutlined, SaveOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { cashAccountsApi, partnersApi } from '../../api/catalog';
import { ApiError, errorMessage } from '../../api/client';
import { documentsApi } from '../../api/documents';
import { qk } from '../../api/queryKeys';
import { reportApi } from '../../api/reports';
import type { DebtSide, Voucher, VoucherBody, VoucherType, VersionConflictDetails } from '../../api/types';
import { vouchersApi } from '../../api/vouchers';
import { useCurrentUser } from '../../auth/AuthContext';
import { DateInput } from '../../components/DateInput';
import { Kbd } from '../../components/Kbd';
import { NumberInput } from '../../components/NumberInput';
import { download } from '../../lib/download';
import { useServerEvent } from '../../lib/events';
import { formatDate, formatDateTime, formatMoney, fromApiDate, toApiDate, todayVn } from '../../lib/format';
import { enterToNext, useHotkeys, userIsTyping } from '../../lib/keyboard';
import { useMenuHighlight } from '../../lib/menuHighlight';
import { moneyInWords } from '../../lib/numberWords';
import { unsavedStore } from '../../lib/unsavedStore';
import { storage } from '../../lib/storage';
import { paths } from '../../paths';
import { PartnerSelect, type PartnerLite } from '../documents/PartnerSelect';
import { useDrawers } from '../reports/drawers';
import { VoucherPrint } from './VoucherPrint';
import { MERGE_COLOR, MERGE_LABEL, applyMerge, conflictText, isOrderItem, needsChoice, threeWay, type MergeChoice, type MergeField, type MergeItem } from '../../lib/merge3';
import { MergeChoicePicker } from '../../components/MergeChoicePicker';
import { DEBT_EFFECT, debtEffect, defaultDebtSide, SIDE_LABEL, VOUCHER_PREFIX } from './voucherText';

interface VLine {
  key: string;
  /** id dòng trên máy chủ lúc nạp (dòng mới gõ thì không có) */
  id?: number;
  description: string;
  amount: number | null;
  document_id: number | null;
  document_no: string | null;
}
let seq = 0;
const nk = () => `v${Date.now().toString(36)}${(seq++).toString(36)}`;
const blankLine = (): VLine => ({ key: nk(), description: '', amount: null, document_id: null, document_no: null });
const isBlank = (l: VLine) => !l.description.trim() && l.amount === null && !l.document_id;
const withBlank = (ls: VLine[]): VLine[] => {
  const t = [...ls];
  while (t.length > 1 && isBlank(t[t.length - 1]!) && isBlank(t[t.length - 2]!)) t.pop();
  return !t.length || !isBlank(t[t.length - 1]!) ? [...t, blankLine()] : t;
};
const LAST_ACC = 'kho.lastAccount';

// Gộp ba chiều khi hai máy cùng sửa (F-10): theo từng ô của từng dòng, không bao giờ thêm dòng tiền cho một lần sửa.
const V_FIELDS: MergeField<VLine>[] = [
  { label: 'Diễn giải', value: (l) => l.description.trim(), copy: (to, f) => ({ ...to, description: f.description }), show: (l) => l.description.trim() || '(trống)' },
  { label: 'Số tiền', value: (l) => l.amount, copy: (to, f) => ({ ...to, amount: f.amount }), show: (l) => (l.amount === null ? '(trống)' : formatMoney(l.amount)) },
  {
    label: 'Chứng từ',
    value: (l) => l.document_id,
    copy: (to, f) => ({ ...to, document_id: f.document_id, document_no: f.document_no }),
    show: (l) => l.document_no ?? '(không)',
  },
];
const linesOf = (v: Voucher): VLine[] =>
  withBlank(v.lines.map((l) => ({ key: nk(), id: l.id, description: l.description, amount: l.amount, document_id: l.document_id, document_no: l.document_no })));
const mergeV = (base: VLine[], mine: VLine[], theirs: VLine[]) =>
  threeWay({
    base: base.filter((l) => !isBlank(l)),
    mine: mine.filter((l) => !isBlank(l)),
    theirs: theirs.filter((l) => !isBlank(l)),
    fields: V_FIELDS,
  });
const applyV = (cur: VLine[], items: MergeItem<VLine>[], choices: Record<string, MergeChoice>) =>
  withBlank(applyMerge(cur.filter((l) => !isBlank(l)), items, choices, V_FIELDS, nk));

/** /phieu-thu-chi/:id và /phieu-thu-chi/moi?loai=receipt&partner_id=&document_id= */
export function VoucherRoute() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const location = useLocation();
  const alias = useRef(new Map<string, string>());
  if (id === 'moi') {
    const t = sp.get('loai') === 'payment' ? 'payment' : 'receipt';
    const key = `new:${t}:${location.key}`;
    return (
      <VoucherEditor
        key={key}
        voucherId={null}
        newType={t}
        prePartnerId={Number(sp.get('partner_id')) || null}
        preDocumentId={Number(sp.get('document_id')) || null}
        onCreated={(nid) => alias.current.set(String(nid), key)}
      />
    );
  }
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return <Result status="404" title="Không tìm thấy phiếu" />;
  return <VoucherEditor key={alias.current.get(String(n)) ?? `v:${n}`} voucherId={n} newType="receipt" prePartnerId={null} preDocumentId={null} onCreated={() => undefined} />;
}

interface Props {
  voucherId: number | null;
  newType: VoucherType;
  prePartnerId: number | null;
  preDocumentId: number | null;
  onCreated: (id: number) => void;
}

function VoucherEditor({ voucherId, newType, prePartnerId, preDocumentId, onCreated }: Props) {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const drawers = useDrawers();
  const { modal, message } = App.useApp();
  const [removed, setRemoved] = useState(false);
  const vq = useQuery({ queryKey: qk.voucher(voucherId ?? 0), queryFn: () => vouchersApi.get(voucherId ?? 0), enabled: voucherId !== null && !removed });
  const accounts = useQuery({ queryKey: qk.catalogList('cash_account', { all: true }), queryFn: () => cashAccountsApi.list({ page_size: 1000 }) });
  const accItems = accounts.data?.items ?? [];

  const [loaded, setLoaded] = useState<Voucher | null>(null);
  const [type, setType] = useState<VoucherType>(newType);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [date, setDate] = useState<Dayjs | null>(todayVn());
  const [partner, setPartner] = useState<PartnerLite | null>(null);
  const [sideChoice, setSideChoice] = useState<DebtSide | null>(null);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<VLine[]>([blankLine()]);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lineErr, setLineErr] = useState<Record<string, string>>({});
  const [headErr, setHeadErr] = useState<Record<string, string>>({});
  const [remote, setRemote] = useState<{ by: string; at: string } | null>(null);
  const [deletedBy, setDeletedBy] = useState<string | null>(null);
  const [stash, setStash] = useState<MergeItem<VLine>[] | null>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const baseLinesRef = useRef<VLine[]>([]);
  const [printOpen, setPrintOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [pending, setPending] = useState<{ key: string; col: 'desc' | 'amount' } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const partnerRef = useRef<{ focus: () => void } | null>(null);
  const skipGuard = useRef(false);

  const effSide: DebtSide = sideChoice ?? defaultDebtSide(type, partner);
  const sent = lines.filter((l) => !isBlank(l));
  const total = sent.reduce((s, l) => s + (l.amount ?? 0), 0);
  const body = (): VoucherBody => ({
    voucher_type: type,
    voucher_date: toApiDate(date) ?? '',
    account_id: accountId,
    partner_id: partner?.id ?? null,
    debt_side: effSide, // luôn gửi rõ
    note: note.trim(),
    // id dòng máy chủ: sửa tại chỗ, giữ id (dòng mới không có)
    lines: sent.map((l) => ({ ...(l.id !== undefined ? { id: l.id } : {}), description: l.description.trim(), amount: l.amount, document_id: l.document_id })),
  });
  const fp = JSON.stringify(body());
  const isNew = voucherId === null && !loaded;
  // Phiếu mới: giá trị tự điền (tài khoản mặc định, đối tác / dòng tiền điền sẵn từ "Thu tiền", "Thu tiền phiếu này") là mốc (F-08)
  const autoFill = useRef(true);
  const [pristine, setPristine] = useState<string | null>(null);
  useEffect(() => {
    if (autoFill.current) {
      autoFill.current = false;
      setPristine(fp);
    }
  }, [fp]);
  const dirty = isNew ? pristine !== null && fp !== pristine : baseline !== null && fp !== baseline;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // ---------- giữ phiếu đang gõ dở khi phiên hết hạn (F-04) ----------
  const draftScope = voucherId !== null ? `voucher:${voucherId}` : `newv:${newType}`;
  interface Stored {
    type: VoucherType;
    accountId: number | null;
    date: string | null;
    partner: PartnerLite | null;
    sideChoice: DebtSide | null;
    note: string;
    lines: VLine[];
  }
  const restoreChecked = useRef(false);
  useEffect(() => {
    if (removed || !restoreChecked.current) return;
    if (dirty) unsavedStore.save(me.id, draftScope, { type, accountId, date: toApiDate(date) ?? null, partner, sideChoice, note, lines } satisfies Stored);
    else unsavedStore.clear(me.id, draftScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp, dirty]);
  const restoreUnsaved = (): boolean => {
    restoreChecked.current = true;
    const st = unsavedStore.load<Stored>(me.id, draftScope);
    if (!st || !st.lines?.some((l) => !isBlank(l))) return false;
    setType(st.type);
    setAccountId(st.accountId);
    setDate(fromApiDate(st.date));
    setPartner(st.partner);
    setSideChoice(st.sideChoice);
    setNote(st.note);
    const baseById = new Map(baseLinesRef.current.filter((b) => b.id !== undefined).map((b) => [b.id, b.key]));
    setLines(withBlank(st.lines.map((l) => (l.id !== undefined && baseById.has(l.id) ? { ...l, key: baseById.get(l.id)! } : l))));
    autoFill.current = false; // khôi phục là thay đổi thật của người dùng, không phải giá trị tự điền
    message.info(unsavedStore.restoredMessage(unsavedStore.reason(me.id, draftScope)), 5);
    return true;
  };

  const load = useCallback(
    (v: Voucher, prepared?: VLine[]) => {
      setLoaded(v);
      setType(v.voucher_type);
      setAccountId(v.account_id);
      setDate(fromApiDate(v.voucher_date));
      const p: PartnerLite | null = v.partner_id ? { id: v.partner_id, code: v.partner_code ?? '', name: v.partner_name ?? '', address: v.partner_address ?? '' } : null;
      setPartner(p);
      setSideChoice(v.debt_side);
      setNote(v.note);
      const ls = prepared ?? linesOf(v);
      setLines(ls);
      baseLinesRef.current = ls;
      setBaseline(
        JSON.stringify({
          voucher_type: v.voucher_type,
          voucher_date: v.voucher_date,
          account_id: v.account_id,
          partner_id: v.partner_id,
          debt_side: v.debt_side,
          note: v.note,
          lines: v.lines.map((l) => ({ id: l.id, description: l.description, amount: l.amount, document_id: l.document_id })),
        }),
      );
      setLineErr({});
      setHeadErr({});
      setRemote(null);
      qc.setQueryData(qk.voucher(v.id), v);
      // cờ KH/NCC của đối tác (để hỏi "hoàn tiền hay thu tiền" khi cần)
      if (v.partner_id)
        void partnersApi.get(v.partner_id).then((pp) => setPartner((cur) => (cur && cur.id === pp.id ? { ...cur, phone: pp.phone, is_customer: pp.is_customer, is_supplier: pp.is_supplier } : cur)));
    },
    [qc],
  );

  // Phiếu có sẵn: nạp lần đầu; máy khác sửa ⇒ tự nạp (nếu chưa sửa gì) hoặc báo
  useEffect(() => {
    const v = vq.data;
    if (!v) return;
    if (!loaded) {
      load(v);
      restoreUnsaved();
      return;
    }
    if (v.id !== loaded.id || v.version === loaded.version) return;
    if (!dirtyRef.current) {
      load(v);
      if (v.updated_by !== me.id) message.info(`Phiếu vừa được ${v.updated_by_name} cập nhật — đã hiện bản mới nhất`, 3);
    } else if (v.updated_by !== me.id) setRemote({ by: v.updated_by_name, at: v.updated_at });
  }, [vq.data, loaded, load, me.id, message]);
  useServerEvent((e) => {
    if (e.type === 'voucher.changed' && loaded && e.id === loaded.id && e.action === 'deleted' && e.by_id !== me.id) setDeletedBy(e.by);
  });

  // Phiếu mới: tài khoản mặc định, điền sẵn đối tác / chứng từ
  useEffect(() => {
    if (!isNew || accountId !== null || !accItems.length) return;
    const last = Number(storage.get(`${LAST_ACC}.${type}`));
    const def = accItems.find((a) => a.active && a.id === last) ?? accItems.find((a) => a.active && a.kind === 'cash') ?? accItems.find((a) => a.active);
    if (def) {
      autoFill.current = true;
      setAccountId(def.id);
    }
  }, [isNew, accountId, accItems, type]);
  const prefilled = useRef(false);
  useEffect(() => {
    if (!isNew || prefilled.current) return;
    prefilled.current = true;
    if (restoreUnsaved()) return; // có phiếu gõ dở của phiên trước ⇒ khôi phục thay cho điền sẵn
    if (preDocumentId) {
      void documentsApi.get(preDocumentId).then((d) => {
        if (d.partner_id) {
          void partnersApi.get(d.partner_id).then((p) => {
            autoFill.current = true;
            setPartner({ id: p.id, code: p.code, name: p.name, phone: p.phone, address: p.address, is_customer: p.is_customer, is_supplier: p.is_supplier });
          });
        }
        const verb = newType === 'receipt' ? 'Thu tiền' : 'Chi tiền';
        autoFill.current = true;
        setLines(withBlank([{ key: nk(), description: `${verb} phiếu ${d.display_no} ngày ${formatDate(d.doc_date)}`, amount: d.total_amount, document_id: d.id, document_no: d.display_no }]));
        message.info('Đã điền sẵn đối tác và số tiền của phiếu — kiểm tra rồi bấm Lưu (Ctrl+S)', 3);
      });
    } else if (prePartnerId) {
      void partnersApi.get(prePartnerId).then((p) => {
            autoFill.current = true;
            setPartner({ id: p.id, code: p.code, name: p.name, phone: p.phone, address: p.address, is_customer: p.is_customer, is_supplier: p.is_supplier });
          });
    }
    window.setTimeout(() => {
      // người dùng đã bấm vào một ô và gõ (vd. ngày) ⇒ không giành con trỏ (chữ đang gõ phải vào đúng ô đó)
      if (userIsTyping()) return;
      if (!preDocumentId && !prePartnerId) partnerRef.current?.focus();
      else gridRef.current?.querySelector<HTMLInputElement>('[data-vcell$=":desc"]')?.focus();
    }, 80);
  }, [isNew, preDocumentId, prePartnerId, newType, message]);

  // ---------- công nợ trước / sau phiếu ----------
  const dateStr = toApiDate(date);
  const debtQ = useQuery({
    queryKey: qk.report('debt-ledger', { partner_id: partner?.id, side: effSide, to: dateStr }),
    queryFn: () => reportApi.debtLedger({ partner_id: partner!.id, side: effSide, to: dateStr }),
    enabled: !!partner && !!dateStr,
  });
  const debt = useMemo(() => {
    if (!debtQ.data || !partner) return null;
    let before = debtQ.data.closing;
    if (loaded && loaded.partner_id === partner.id && loaded.debt_side === effSide && dateStr && loaded.voucher_date <= dateStr)
      before -= debtEffect(loaded.voucher_type, loaded.debt_side, loaded.total_amount);
    return { before, after: before + debtEffect(type, effSide, total) };
  }, [debtQ.data, partner, loaded, effSide, dateStr, type, total]);

  // chứng từ của đối tác để liên kết dòng tiền
  const docsQ = useQuery({
    queryKey: [...qk.documents, 'for-voucher', partner?.id],
    queryFn: () => documentsApi.list({ partner_id: partner!.id, status: 'posted', page_size: 200 }),
    enabled: !!partner,
    staleTime: 30_000,
  });
  const docOptions = (docsQ.data?.items ?? []).map((d) => ({
    value: d.id,
    label: `${d.display_no} · ${formatDate(d.doc_date)} · ${formatMoney(d.total_amount)}`,
    no: d.display_no,
    total: d.total_amount,
    date: d.doc_date,
  }));

  // ---------- lưới dòng tiền ----------
  // đặt con trỏ ngay sau khi vẽ (trước khi trình duyệt nhận phím kế tiếp)
  useLayoutEffect(() => {
    if (!pending) return;
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-vcell="${pending.key}:${pending.col}"]`);
    if (el) {
      el.focus();
      el.select();
    }
    setPending(null);
  }, [pending, lines]);
  const update = (key: string, patch: Partial<VLine>) => {
    setLines((ls) => withBlank(ls.map((l) => (l.key === key ? { ...l, ...patch } : l))));
    if (lineErr[key]) setLineErr({});
  };
  const cellKey = (l: VLine, col: 'desc' | 'amount') => (e: KeyboardEvent<HTMLInputElement>) => {
    const idx = lines.findIndex((x) => x.key === l.key);
    if (e.key === 'Delete' && e.ctrlKey) {
      e.preventDefault();
      const next = withBlank(lines.filter((x) => x.key !== l.key));
      setLines(next);
      const t = next[Math.min(idx, next.length - 1)];
      if (t) setPending({ key: t.key, col: 'desc' });
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const t = lines[idx + (e.key === 'ArrowDown' ? 1 : -1)];
      if (t) {
        e.preventDefault();
        setPending({ key: t.key, col });
      }
      return;
    }
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (col === 'desc') {
      if (!isBlank(l)) setPending({ key: l.key, col: 'amount' });
      return;
    }
    const t = lines[idx + 1];
    if (t) setPending({ key: t.key, col: 'desc' });
    else {
      const nl = blankLine();
      setLines((ls) => [...ls, nl]);
      setPending({ key: nl.key, col: 'desc' });
    }
  };

  // ---------- chặn rời trang ----------
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !skipGuard.current && dirtyRef.current && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search);
  const shown = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || shown.current) return;
    shown.current = true;
    modal.confirm({
      title: 'Phiếu chưa lưu',
      content: 'Bạn có thay đổi chưa lưu. Rời đi bây giờ sẽ mất các thay đổi này.',
      okText: 'Bỏ thay đổi, rời đi',
      okButtonProps: { danger: true },
      cancelText: 'Ở lại phiếu',
      autoFocusButton: 'cancel',
      onOk: () => {
        shown.current = false;
        unsavedStore.clear(me.id, draftScope);
        blocker.proceed?.();
      },
      onCancel: () => {
        shown.current = false;
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

  // ---------- lưu / xóa ----------
  const reloadKeepingMine = async () => {
    if (!loaded) return;
    const base = baseLinesRef.current;
    const mine = lines;
    const fresh = await vouchersApi.get(loaded.id);
    const theirs = linesOf(fresh);
    const items = mergeV(base, mine, theirs);
    setStash(items.length ? items : null);
    setChoices({});
    load(fresh, theirs);
  };
  const save = async () => {
    if (saving || deletedBy) return null;
    const he: Record<string, string> = {};
    if (!accountId) he.account_id = 'Chọn tài khoản tiền (tiền mặt hay ngân hàng)';
    if (!date) he.voucher_date = 'Nhập ngày';
    const bad = sent.find((l) => l.amount === null || l.amount <= 0);
    if (!sent.length) he.lines = 'Nhập ít nhất một dòng tiền';
    setHeadErr(he);
    if (bad) {
      setLineErr({ [bad.key]: 'Nhập số tiền lớn hơn 0' });
      setPending({ key: bad.key, col: 'amount' });
    }
    if (Object.keys(he).length || bad) {
      message.error(Object.values(he)[0] ?? 'Có dòng chưa có số tiền', 3);
      return null;
    }
    setSaving(true);
    try {
      const v = loaded ? await vouchersApi.update(loaded.id, { ...body(), version: loaded.version }) : await vouchersApi.create(body());
      storage.set(`${LAST_ACC}.${type}`, String(v.account_id));
      const wasNew = !loaded;
      load(v);
      if (wasNew) {
        onCreated(v.id);
        skipGuard.current = true;
        navigate(paths.voucher(v.id), { replace: true });
        window.setTimeout(() => (skipGuard.current = false), 0);
      }
      message.success(`Đã lưu ${v.voucher_no} — sổ quỹ và công nợ đã cập nhật`, 2);
      void qc.invalidateQueries({ queryKey: qk.vouchers });
      return v;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        const d = e.details as VersionConflictDetails | null;
        modal.confirm({
          title: 'Máy khác vừa sửa phiếu này',
          content: (
            <p>
              <b>{d?.updated_by ?? 'Một người khác'}</b> đã lưu phiếu lúc {d ? formatDateTime(d.updated_at) : '…'}. Phần bạn vừa sửa <b>chưa được lưu</b>. Bấm
              "Tải bản mới" để xem bản mới nhất; các dòng bạn đã nhập được giữ trong khung vàng để thêm lại.
            </p>
          ),
          okText: 'Tải bản mới',
          cancelText: 'Để tôi xem lại',
          onOk: () => reloadKeepingMine(),
        });
      } else if (e instanceof ApiError && e.code === 'VALIDATION' && e.lineNo !== undefined && sent[e.lineNo - 1]) {
        setLineErr({ [sent[e.lineNo - 1]!.key]: e.message });
        message.error(e.message, 4);
      } else if (e instanceof ApiError && e.code === 'VALIDATION' && e.field) {
        setHeadErr({ [e.field]: e.message });
        message.error(e.message, 4);
      } else if (e instanceof ApiError && e.status === 401) {
        // đã về màn đăng nhập; phiếu đang gõ được giữ lại để khôi phục (F-04)
      } else modal.error({ title: 'Không lưu được', content: errorMessage(e) });
      return null;
    } finally {
      setSaving(false);
    }
  };
  const remove = () => {
    if (!loaded) return;
    modal.confirm({
      title: `Xóa phiếu ${loaded.voucher_no}?`,
      content: `Số tiền ${formatMoney(loaded.total_amount)} sẽ không còn trong sổ quỹ và công nợ. Xóa xong không khôi phục được (lịch sử vẫn lưu).`,
      okText: 'Xóa phiếu',
      okButtonProps: { danger: true },
      cancelText: 'Không xóa',
      autoFocusButton: 'cancel',
      onOk: async () => {
        setRemoved(true);
        await qc.cancelQueries({ queryKey: ['voucher', loaded.id] });
        try {
          await vouchersApi.remove(loaded.id, loaded.version);
          message.success(`Đã xóa phiếu ${loaded.voucher_no}`, 2);
          skipGuard.current = true;
          unsavedStore.clear(me.id, draftScope);
          await qc.cancelQueries({ queryKey: ['voucher', loaded.id] });
          qc.removeQueries({ queryKey: ['voucher', loaded.id] });
          void qc.invalidateQueries({ queryKey: qk.vouchers });
          navigate(loaded.voucher_type === 'receipt' ? paths.receipts : paths.payments);
        } catch (e) {
          setRemoved(false);
          modal.error({ title: 'Không xóa được', content: errorMessage(e) });
        }
      },
    });
  };
  const needSaved = (what: string) => {
    if (!loaded || dirty) {
      message.warning(`Lưu phiếu (Ctrl+S) trước khi ${what}`, 2.5);
      return true;
    }
    return false;
  };

  useHotkeys({
    'Ctrl+s': () => void save(),
    'Ctrl+p': () => !needSaved('in') && setPrintOpen(true),
    F2: () => navigate(paths.newVoucher(type)),
  });
  useMenuHighlight(type === 'receipt' ? paths.receipts : paths.payments, loaded ? `${loaded.voucher_type_name} ${loaded.voucher_no}` : type === 'receipt' ? 'Phiếu thu (mới)' : 'Phiếu chi (mới)');

  if (voucherId !== null && vq.isError && !loaded)
    return <Result status="404" title="Không tìm thấy phiếu" subTitle={errorMessage(vq.error)} extra={<Button onClick={() => navigate(-1)}>Quay lại</Button>} />;
  if (voucherId !== null && !loaded) return <Skeleton active paragraph={{ rows: 8 }} />;

  const acc = accItems.find((a) => a.id === accountId);
  const prefix = acc ? VOUCHER_PREFIX[type][acc.kind] : null;
  const receipt = type === 'receipt';
  const showSide = !!partner && ((receipt && partner.is_supplier) || (!receipt && partner.is_customer));
  const sideOpts: DebtSide[] = receipt ? ['receivable', 'payable'] : ['payable', 'receivable'];
  const accOptions = accItems.filter((a) => a.active || a.id === accountId).sort((x, y) => (x.kind === y.kind ? x.code.localeCompare(y.code) : x.kind === 'cash' ? -1 : 1));

  return (
    <div className="doc-editor voucher-editor">
      <div className="doc-top">
        <Tooltip title="Về danh sách">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(receipt ? paths.receipts : paths.payments)} aria-label="Về danh sách" />
        </Tooltip>
        <div className="doc-title">
          <h2>{receipt ? 'Phiếu thu tiền' : 'Phiếu chi tiền'}</h2>
          <div className="doc-no">{loaded ? <>Số <b>{loaded.voucher_no}</b></> : <span className="muted">Số phiếu cấp khi lưu{prefix && ` (${prefix}…)`}</span>}</div>
        </div>
        <span className={`doc-status ${loaded ? (dirty ? 'st-editing' : 'st-posted') : 'st-new'}`}>{loaded ? (dirty ? 'ĐANG SỬA — chưa lưu' : 'ĐÃ LƯU — có hiệu lực') : 'PHIẾU MỚI — chưa lưu'}</span>
        <div className="doc-actions">
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()} disabled={!!deletedBy}>
            Lưu <Kbd>Ctrl+S</Kbd>
          </Button>
          <Dropdown.Button
            disabled={!loaded}
            onClick={() => !needSaved('in') && setPrintOpen(true)}
            icon={<span className="dd-caret">▾</span>}
            menu={{
              items: [
                { key: 'xlsx', icon: <FileExcelOutlined />, label: 'Xuất Excel (.xlsx)' },
                { key: 'docx', icon: <FileWordOutlined />, label: 'Xuất Word (.docx)' },
              ],
              onClick: ({ key }) => loaded && !needSaved('xuất file') && download(vouchersApi.exportUrl(loaded.id, key === 'docx' ? 'docx' : 'xlsx')),
            }}
          >
            <PrinterOutlined /> In
          </Dropdown.Button>
          {loaded && (
            <Tooltip title="Lịch sử sửa phiếu">
              <Button icon={<HistoryOutlined />} onClick={() => setHistOpen(true)} aria-label="Lịch sử sửa phiếu" />
            </Tooltip>
          )}
          {loaded && (
            <Tooltip title="Xóa phiếu">
              <Button danger icon={<DeleteOutlined />} onClick={remove} aria-label="Xóa phiếu" />
            </Tooltip>
          )}
        </div>
      </div>
      {loaded && (
        <div className="doc-meta">
          Lập: {loaded.created_by_name} {formatDateTime(loaded.created_at)} · Sửa lần cuối: <b>{loaded.updated_by_name}</b> {formatDateTime(loaded.updated_at)}
        </div>
      )}
      {deletedBy && <Alert className="doc-alert" type="error" showIcon message={`Phiếu này vừa bị ${deletedBy} xóa.`} />}
      {remote && (
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
              {stash.map((c) => {
                const before = c.kind === 'edited' || c.kind === 'conflict' ? c.base : null;
                return (
                  <div key={c.id} className="stash-vline">
                    <Tag color={MERGE_COLOR[c.kind]}>{MERGE_LABEL[c.kind]}</Tag>
                    {isOrderItem(c.kind) ? (
                      'Bạn đã dời thứ tự các dòng'
                    ) : (
                      <>
                    {before && before.description.trim() !== c.line.description.trim() ? (
                      <>
                        {before.description} → <b>{c.line.description}</b>
                      </>
                    ) : (
                      c.line.description
                    )}{' '}
                    —{' '}
                    {before && before.amount !== c.line.amount ? (
                      <>
                        {formatMoney(before.amount)} → <b>{formatMoney(c.line.amount)}</b>
                      </>
                    ) : (
                      <b>{formatMoney(c.line.amount)}</b>
                    )}{' '}
                    {c.line.document_no && <span className="muted">({c.line.document_no})</span>}
                      </>
                    )}
                    {needsChoice(c.kind) && (
                      <div className="stash-choice">
                        <MergeChoicePicker text={conflictText(c)} value={choices[c.id] ?? 'theirs'} onChange={(v) => setChoices((x) => ({ ...x, [c.id]: v }))} />
                      </div>
                    )}
                  </div>
                );
              })}
              {stash.some((c) => needsChoice(c.kind)) && (
                <div className="merge-hint">
                  Dòng hai máy cùng sửa: mặc định <b>giữ của máy kia</b> (bản đã lưu). Chọn “Dùng của tôi” nếu số của bạn mới đúng, rồi bấm
                  “Thêm các dòng này vào phiếu”. Phần chỉ một bên sửa được gộp tự động.
                </div>
              )}
              <Space style={{ marginTop: 6 }}>
                <Button size="small" onClick={() => (setLines((ls) => applyV(ls, stash, choices)), setStash(null))}>
                  Thêm các dòng này vào phiếu
                </Button>
                <Button size="small" onClick={() => setStash(null)}>
                  Ẩn
                </Button>
              </Space>
            </div>
          }
        />
      )}

      <div
        className="voucher-header"
        data-enter-scope
        onKeyDownCapture={enterToNext(() => {
          const first = lines.find(isBlank) ?? lines[0];
          if (first) setPending({ key: first.key, col: 'desc' });
        })}
      >
        <div className="vh-row">
          <div className="hf">
            <label>Loại phiếu</label>
            <Segmented<VoucherType>
              className="big-seg"
              aria-label="Loại phiếu"
              value={type}
              onChange={(t) => {
                setType(t);
                setSideChoice(null);
              }}
              options={[
                { label: 'THU tiền', value: 'receipt' },
                { label: 'CHI tiền', value: 'payment' },
              ]}
            />
          </div>
          <div className={`hf hf-acc${headErr.account_id ? ' hf-err' : ''}`}>
            <label>Thu/chi bằng</label>
            <Radio.Group className="acc-choice" aria-label="Thu/chi bằng tài khoản" value={accountId} onChange={(e) => setAccountId(e.target.value as number)}>
              {accOptions.map((a) => (
                <Radio.Button key={a.id} value={a.id}>
                  <span className="acc-kind">{a.kind === 'cash' ? 'Tiền mặt' : 'Ngân hàng'}</span>
                  <span className="acc-name">
                    {a.code} · {a.name}
                  </span>
                </Radio.Button>
              ))}
            </Radio.Group>
            {acc && (
              <div className="muted acc-hint">
                Số phiếu: <b>{VOUCHER_PREFIX[type][acc.kind]}…</b> ({acc.kind === 'cash' ? (receipt ? 'phiếu thu tiền mặt' : 'phiếu chi tiền mặt') : receipt ? 'giấy báo có' : 'giấy báo nợ'})
              </div>
            )}
            {headErr.account_id && <div className="hf-msg">{headErr.account_id}</div>}
          </div>
        </div>
        <div className="vh-row">
          <div className={`hf hf-date${headErr.voucher_date ? ' hf-err' : ''}`}>
            <label htmlFor="voucher_date">Ngày</label>
            <DateInput id="voucher_date" value={date} onChange={setDate} />
          </div>
          <div className={`hf hf-partner${headErr.partner_id ? ' hf-err' : ''}`}>
            <label htmlFor="partner">{receipt ? 'Người nộp / khách hàng' : 'Người nhận / nhà cung cấp'} (bỏ trống nếu thu/chi khác)</label>
            <PartnerSelect
              ref={(r) => (partnerRef.current = r)}
              id="partner"
              value={partner?.id ?? null}
              current={partner}
              allowClear
              onChange={(p) => {
                setPartner(p);
                setSideChoice(null);
              }}
              placeholder="Gõ mã, tên, điện thoại… (bỏ trống = thu/chi khác)"
            />
            {headErr.partner_id && <div className="hf-msg">{headErr.partner_id}</div>}
          </div>
          <div className="hf hf-note">
            <label htmlFor="vnote">Ghi chú / lý do</label>
            <Input id="vnote" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {showSide && (
          <div className="side-choice">
            <span className="muted">Đối tác này {partner?.is_customer && partner?.is_supplier ? 'vừa là khách hàng vừa là nhà cung cấp' : receipt ? 'là nhà cung cấp' : 'là khách hàng'}. Phiếu này là:</span>
            <Radio.Group value={effSide} onChange={(e) => setSideChoice(e.target.value as DebtSide)}>
              {sideOpts.map((s) => (
                <Radio key={s} value={s}>
                  {DEBT_EFFECT[type][s]}
                </Radio>
              ))}
            </Radio.Group>
          </div>
        )}
        {partner && debt && (
          <div className="debt-line">
            Công nợ {SIDE_LABEL[effSide].toLowerCase()} của <b>{partner.name}</b> đến {formatDate(date)}: trước phiếu này <b>{formatMoney(debt.before)}</b> → sau phiếu này{' '}
            <b className={debt.after < 0 ? 'neg' : 'pos'}>{formatMoney(debt.after)}</b>
            {debt.after < 0 && <span className="neg"> (âm: {effSide === 'receivable' ? 'khách trả dư' : 'mình trả dư'})</span>}
            <Button type="link" size="small" onClick={() => drawers.push({ kind: 'debt', partner: { id: partner.id, code: partner.code, name: partner.name }, side: effSide })}>
              Xem sổ công nợ
            </Button>
          </div>
        )}
        {!partner && <div className="debt-line muted">Không chọn đối tác: phiếu {receipt ? 'thu' : 'chi'} khác, không vào công nợ.</div>}
      </div>

      <div className="doc-body" ref={gridRef}>
        <div className="line-grid">
          <table>
            <colgroup>
              <col style={{ width: 40 }} />
              <col />
              <col style={{ width: 280 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="num">STT</th>
                <th>Diễn giải</th>
                <th>
                  <Tooltip title="Tùy chọn: phiếu bán/mua của đối tác mà khoản tiền này thu/trả cho (để tra cứu)">Chứng từ liên quan</Tooltip>
                </th>
                <th className="num">Số tiền</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const blank = isBlank(l);
                return (
                  <tr key={l.key} className={lineErr[l.key] ? 'row-error' : blank ? 'row-blank' : undefined}>
                    <td className="num stt">{blank ? '' : i + 1}</td>
                    <td>
                      <input
                        className="cell-input"
                        data-vcell={`${l.key}:desc`}
                        value={l.description}
                        placeholder={blank ? (i === 0 ? `Diễn giải (vd. ${receipt ? 'Thu nợ tháng 10' : 'Trả tiền hàng'})` : 'Diễn giải…') : ''}
                        maxLength={500}
                        onChange={(e) => update(l.key, { description: e.target.value })}
                        onKeyDown={cellKey(l, 'desc')}
                        onFocus={(e) => e.target.select()}
                      />
                      {lineErr[l.key] && <div className="line-note neg">{lineErr[l.key]}</div>}
                    </td>
                    <td>
                      <Select<number>
                        size="small"
                        variant="borderless"
                        allowClear
                        showSearch
                        filterOption={filterByLabel}
                        disabled={!partner}
                        placeholder={partner ? 'chọn phiếu (tùy chọn)' : ''}
                        value={l.document_id ?? undefined}
                        style={{ width: '100%' }}
                        tabIndex={-1}
                        options={docOptions}
                        notFoundContent="Đối tác chưa có phiếu đã ghi sổ"
                        onChange={(v) => {
                          const o = docOptions.find((x) => x.value === v);
                          update(l.key, {
                            document_id: v ?? null,
                            document_no: o?.no ?? null,
                            amount: l.amount ?? o?.total ?? null,
                            description: l.description || (o ? `${receipt ? 'Thu' : 'Chi'} tiền phiếu ${o.no} ngày ${formatDate(o.date)}` : ''),
                          });
                        }}
                      />
                    </td>
                    <td className="num">
                      <NumberInput
                        kind="money"
                        className="cell-num"
                        variant="borderless"
                        dataCell={undefined}
                        value={l.amount}
                        onChange={(v) => update(l.key, { amount: v })}
                        onKeyDown={cellKey(l, 'amount')}
                        aria-label={`Số tiền dòng ${i + 1}`}
                        {...{ 'data-vcell': `${l.key}:amount` }}
                      />
                    </td>
                    <td className="act">
                      {!blank && (
                        <Button
                          type="text"
                          size="small"
                          danger
                          tabIndex={-1}
                          icon={<DeleteOutlined />}
                          aria-label={`Xóa dòng ${i + 1}`}
                          onClick={() => setLines((ls) => withBlank(ls.filter((x) => x.key !== l.key)))}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid-tools">
            <Button size="small" type="link" icon={<PlusOutlined />} tabIndex={-1} onClick={() => setLines((ls) => [...ls.filter((x) => !isBlank(x)), blankLine()])}>
              Thêm dòng
            </Button>
            <span className="hint">Enter: Diễn giải → Số tiền → dòng sau · ↑↓ đổi dòng · Ctrl+Delete xóa dòng · nhiều dòng tiền cho cùng một đối tác</span>
            {headErr.lines && <span className="neg">{headErr.lines}</span>}
          </div>
        </div>
      </div>

      <div className="doc-footer">
        <div className="doc-check">
          <div className="money-words">
            Bằng chữ: <i>{total ? moneyInWords(total) : '—'}</i>
          </div>
          {dirty && <div className="muted">Có thay đổi chưa lưu — phiếu thu/chi có hiệu lực ngay khi lưu</div>}
        </div>
        <div className="doc-sums">
          <div>
            <span>Số dòng</span>
            <b>{sent.length}</b>
          </div>
          <div className="sum-main">
            <span>Tổng tiền {receipt ? 'thu' : 'chi'}</span>
            <b>{formatMoney(total)}</b>
          </div>
        </div>
      </div>

      {loaded && <VoucherHistory id={loaded.id} open={histOpen} onClose={() => setHistOpen(false)} />}
      {loaded && printOpen && (
        <>
          <Modal
            open
            width={760}
            title="Xem trước bản in (khổ A5)"
            onCancel={() => setPrintOpen(false)}
            footer={
              <Space>
                <Button onClick={() => setPrintOpen(false)}>Đóng</Button>
                <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} autoFocus>
                  In
                </Button>
              </Space>
            }
          >
            <div className="print-preview size-A5">
              <VoucherPrint v={loaded} />
            </div>
          </Modal>
          {createPortal(
            <div id="print-root" className="size-A5">
              <style>{'@page { size: A5 landscape; margin: 8mm; }'}</style>
              <VoucherPrint v={loaded} />
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}

const ACT = { created: ['Lập phiếu', 'blue'], updated: ['Sửa phiếu', 'orange'], deleted: ['Xóa phiếu', 'red'] } as const;

function VoucherHistory({ id, open, onClose }: { id: number; open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['voucher', id, 'history'], queryFn: () => vouchersApi.history(id), enabled: open });
  const describe = (b: Voucher | null, a: Voucher | null): string[] => {
    if (!b || !a) return [];
    const out: string[] = [];
    if (b.voucher_no !== a.voucher_no) out.push(`Số phiếu: ${b.voucher_no} → ${a.voucher_no}`);
    if (b.voucher_date !== a.voucher_date) out.push(`Ngày: ${formatDate(b.voucher_date)} → ${formatDate(a.voucher_date)}`);
    if (b.account_name !== a.account_name) out.push(`Tài khoản: ${b.account_name} → ${a.account_name}`);
    if (b.partner_name !== a.partner_name) out.push(`Đối tác: ${b.partner_name ?? '(không)'} → ${a.partner_name ?? '(không)'}`);
    if (b.note !== a.note) out.push(`Ghi chú: ${b.note || '(trống)'} → ${a.note || '(trống)'}`);
    const bl = b.lines.map((l) => `${l.description}: ${formatMoney(l.amount)}`);
    const al = a.lines.map((l) => `${l.description}: ${formatMoney(l.amount)}`);
    bl.filter((x) => !al.includes(x)).forEach((x) => out.push(`Bỏ dòng ${x}`));
    al.filter((x) => !bl.includes(x)).forEach((x) => out.push(`Thêm dòng ${x}`));
    if (b.total_amount !== a.total_amount) out.push(`Tổng tiền: ${formatMoney(b.total_amount)} → ${formatMoney(a.total_amount)}`);
    return out;
  };
  return (
    <Drawer open={open} onClose={onClose} title="Lịch sử sửa phiếu" width={480}>
      {q.isLoading ? (
        <Skeleton active />
      ) : (
        <Timeline
          items={[...(q.data?.items ?? [])].reverse().map((e) => ({
            color: ACT[e.action][1],
            children: (
              <div className="hist-entry">
                <Tag color={ACT[e.action][1]}>{ACT[e.action][0]}</Tag>
                <b>{e.user_name}</b> <span className="muted">· {formatDateTime(e.at)}</span>
                {e.action === 'created' && e.after && (
                  <div className="muted">
                    {e.after.voucher_no} · {e.after.lines.length} dòng · {formatMoney(e.after.total_amount)}
                  </div>
                )}
                {e.action === 'updated' && (
                  <ul className="hist-changes">
                    {describe(e.before, e.after).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          }))}
        />
      )}
    </Drawer>
  );
}
