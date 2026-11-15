// Màn hình bản mở rộng đợt M3: Bảng kê thuế GTGT (C11), Mẫu in (C12), Nhật ký thay đổi.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Input, Segmented, Select, Skeleton, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { errorMessage } from '../../api/client';
import { usersApi } from '../../api/catalog';
import { auditApi, printTemplateApi, vatApi, type AuditParams } from '../../api/extended';
import type { AuditEntry, DocumentFull, PrintTemplate, Voucher, VatRow, VatSide } from '../../api/types';
import { useCan } from '../../auth/AuthContext';
import { DateRangeFilter, describeRange, rangeOf, type DateRangeValue } from '../../components/DateRangeFilter';
import { Kbd } from '../../components/Kbd';
import { PageHeader } from '../../components/PageHeader';
import { OpenHint, PrintTitle, ReportActions, ReportTable } from '../../components/ReportTable';
import { formatDate, formatDateTime, formatMoney, toApiDate, todayVn } from '../../lib/format';
import { useHotkeys } from '../../lib/keyboard';
import { DOC_TYPE_LABEL, ROLE_LABEL } from '../../lib/labels';
import { qkPrintTemplate, type ActiveTemplate } from '../../lib/printTemplate';
import { PrintSheet } from '../documents/PrintSheet';
import { useDrawers } from '../reports/drawers';
import { VoucherPrint } from '../vouchers/VoucherPrint';

// ---------- C11: Bảng kê thuế GTGT ----------
export function VatSummaryPage() {
  const drawers = useDrawers();
  const costView = useCan('cost.view');
  const [range, setRange] = useState<DateRangeValue>({ preset: 'month', range: [null, null] });
  const [from, to] = rangeOf(range);
  const params = useMemo(() => ({ from: toApiDate(from), to: toApiDate(to) }), [from?.valueOf(), to?.valueOf()]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ['reports', 'vat-summary', params], queryFn: () => vatApi.summary(params) });
  const d = q.data;
  const columns: ColumnsType<VatRow> = [
    { title: 'Thuế suất', dataIndex: 'label', render: (s: string) => <b>{s}</b> },
    { title: 'Tiền hàng (trước thuế)', dataIndex: 'goods_amount', width: 170, align: 'right', render: (n: number) => formatMoney(n) },
    { title: 'Tiền thuế GTGT', dataIndex: 'tax_amount', width: 150, align: 'right', render: (n: number) => formatMoney(n) },
    { title: 'Tổng thanh toán', dataIndex: 'total', width: 170, align: 'right', render: (n: number) => <b>{formatMoney(n)}</b> },
  ];
  const side = (title: string, s: VatSide | null | undefined, report: 'sales' | 'purchases') =>
    s ? (
      <section className="vat-side">
        <h3>
          {title} <span className="muted">· {s.document_count} phiếu</span>
        </h3>
        <ReportTable<VatRow>
          columns={columns}
          rows={s.rows}
          rowKey={(r) => r.label}
          height={Math.min(300, 80 + s.rows.length * 39)}
          minWidth={620}
          summary={[<b key="c">Cộng</b>, <b key="g">{formatMoney(s.totals.goods_amount)}</b>, <b key="t">{formatMoney(s.totals.tax_amount)}</b>, <b key="s">{formatMoney(s.totals.total)}</b>]}
          onOpen={() => drawers.push({ kind: 'tradeRange', report, title: `${title} — chi tiết từng dòng (${describeRange(range)})`, range })}
          emptyText="Không có phiếu nào trong khoảng này."
        />
      </section>
    ) : null;
  return (
    <div className="list-page vat-page">
      <PageHeader
        title="Bảng kê thuế GTGT"
        sub="Tổng hợp theo thuế suất. Bán ra = phiếu bán − khách trả hàng; mua vào = phiếu nhập mua − trả hàng NCC (phiếu đã ghi sổ). Bấm một dòng để xem chi tiết từng dòng hàng."
        actions={<ReportActions xlsxUrl={vatApi.summaryXlsx(params)} />}
      />
      <div className="toolbar">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      {q.isError && <Alert type="error" showIcon message={errorMessage(q.error)} />}
      {q.isLoading && <Skeleton active />}
      <div className="report-area vat-area">
        <PrintTitle title="BẢNG KÊ THUẾ GTGT" filters={[describeRange(range)]} />
        {side('Bán ra', d?.sales, 'sales')}
        {costView && side('Mua vào', d?.purchases, 'purchases')}
      </div>
      <OpenHint what="xem chi tiết" />
    </div>
  );
}

// ---------- C12: Mẫu in ----------
const SIGN_KEYS: { key: string; label: string }[] = [
  { key: 'sale', label: DOC_TYPE_LABEL.sale },
  { key: 'sale_return', label: DOC_TYPE_LABEL.sale_return },
  { key: 'purchase', label: DOC_TYPE_LABEL.purchase },
  { key: 'purchase_return', label: DOC_TYPE_LABEL.purchase_return },
  { key: 'transfer', label: DOC_TYPE_LABEL.transfer },
  { key: 'opening', label: DOC_TYPE_LABEL.opening },
  { key: 'stocktake', label: 'Biên bản kiểm kê' },
  { key: 'receipt', label: 'Phiếu thu' },
  { key: 'payment', label: 'Phiếu chi' },
];

const SAMPLE_DOC: DocumentFull = {
  id: 0,
  doc_type: 'sale',
  doc_type_name: 'Phiếu bán hàng',
  doc_no: 'XK00001',
  draft_no: 'TAM000001',
  display_no: 'XK00001',
  doc_date: '2026-01-15',
  status: 'posted',
  partner_id: 1,
  partner_code: 'KH01',
  partner_name: 'Khách hàng mẫu',
  partner_address: '12 Lê Lợi, Q.1, TP.HCM',
  partner_phone: '0909 000 000',
  warehouse_id: 1,
  warehouse_code: 'KHO1',
  warehouse_name: 'Kho chính',
  to_warehouse_id: null,
  to_warehouse_code: null,
  to_warehouse_name: null,
  note: '',
  total_amount: 1550000,
  version: 1,
  created_by: 1,
  created_by_name: 'Người lập',
  updated_by: 1,
  updated_by_name: 'Người lập',
  posted_by: 1,
  posted_by_name: 'Người lập',
  posted_at: '2026-01-15T03:00:00Z',
  created_at: '2026-01-15T03:00:00Z',
  updated_at: '2026-01-15T03:00:00Z',
  lines: [
    { id: 1, line_no: 1, product_id: 1, product_code: 'QH32', product_name: 'Que hàn 3.2mm', is_service: false, description: '', unit: 'Hộp', qty: 10, unit_price: 125000, amount: 1250000, note: '' },
    { id: 2, line_no: 2, product_id: 2, product_code: 'GT01', product_name: 'Găng tay da', is_service: false, description: '', unit: 'Đôi', qty: 10, unit_price: 30000, amount: 300000, note: '' },
  ],
  warnings: [],
  old_debt: 0,
  total_debt: 1550000,
} as unknown as DocumentFull;

const SAMPLE_VOUCHER = {
  id: 0,
  voucher_type: 'receipt',
  voucher_type_name: 'Phiếu thu tiền mặt',
  voucher_no: 'PT00001',
  voucher_date: '2026-01-15',
  debt_side: 'receivable',
  account_id: 1,
  account_name: 'Quỹ tiền mặt',
  account_kind: 'cash',
  partner_id: 1,
  partner_code: 'KH01',
  partner_name: 'Khách hàng mẫu',
  partner_address: '12 Lê Lợi, Q.1, TP.HCM',
  note: 'Thu nợ',
  total_amount: 1550000,
  lines: [{ id: 1, line_no: 1, description: 'Thu tiền phiếu XK00001', amount: 1550000, document_id: null, document_no: null }],
  version: 1,
  created_by_name: 'Người lập',
  updated_by_name: 'Người lập',
  created_at: '2026-01-15T03:00:00Z',
  updated_at: '2026-01-15T03:00:00Z',
} as unknown as Voucher;

export function PrintTemplatePage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qkPrintTemplate, queryFn: printTemplateApi.get });
  const [t, setT] = useState<PrintTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<'doc' | 'voucher'>('doc');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data) setT({ ...q.data.template, signatures: { ...q.data.template.signatures } });
  }, [q.data]);
  const defaults = q.data?.default_signatures ?? {};
  const dirty = !!q.data && !!t && JSON.stringify(strip(t)) !== JSON.stringify(strip(q.data.template));

  const save = async () => {
    if (!t || !dirty) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await printTemplateApi.set(strip(t));
      qc.setQueryData(qkPrintTemplate, r);
      message.success('Đã lưu mẫu in', 1.5);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  useHotkeys({ 'Ctrl+s': () => void save() });
  const upload = async (f: File) => {
    setErr(null);
    if (f.size > 500 * 1024) return setErr('Ảnh lớn hơn 500 KB — hãy thu nhỏ ảnh rồi chọn lại');
    try {
      await printTemplateApi.uploadLogo(f);
      await qc.invalidateQueries({ queryKey: qkPrintTemplate });
      message.success('Đã đổi logo', 1.5);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const removeLogo = async () => {
    try {
      await printTemplateApi.removeLogo();
      await qc.invalidateQueries({ queryKey: qkPrintTemplate });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  if (q.isLoading || !t) return <Skeleton active />;
  const saved = q.data!.template;
  const live: ActiveTemplate = { ...q.data!, template: t, logoUrl: saved.has_logo ? printTemplateApi.logoUrl(saved.logo_updated_at) : null };
  const set = (patch: Partial<PrintTemplate>) => setT((x) => (x ? { ...x, ...patch } : x));
  return (
    <div className="tpl-page">
      <PageHeader
        title="Mẫu in"
        sub="Logo, khổ giấy, chân trang, cột và tên ô ký dùng cho mọi bản in (phiếu, phiếu thu chi, biên bản kiểm kê; báo cáo in thêm logo và chân trang). File Excel / Word dùng cùng tên ô ký và chân trang."
        actions={
          <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={() => void save()}>
            Lưu <Kbd>Ctrl+S</Kbd>
          </Button>
        }
      />
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 8 }} />}
      <div className="tpl-layout">
        <div className="tpl-form">
          <section>
            <h4>Logo</h4>
            <Space align="center" wrap>
              {live.logoUrl ? <img className="tpl-logo" src={live.logoUrl} alt="Logo hiện tại" /> : <span className="muted">Chưa có logo</span>}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                style={{ display: 'none' }}
                aria-label="Chọn ảnh logo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f);
                }}
              />
              <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
                {saved.has_logo ? 'Đổi logo' : 'Chọn logo'}
              </Button>
              {saved.has_logo && (
                <Button danger icon={<DeleteOutlined />} onClick={() => void removeLogo()}>
                  Bỏ logo
                </Button>
              )}
            </Space>
            <div className="muted">Ảnh PNG hoặc JPG, tối đa 500 KB. Logo đổi ngay (không cần bấm Lưu).</div>
          </section>
          <section>
            <h4>Khổ giấy mặc định</h4>
            <Space wrap>
              <span>Phiếu hàng</span>
              <Segmented<'A4' | 'A5'> value={t.paper_size_document} onChange={(v) => set({ paper_size_document: v })} options={['A4', 'A5']} />
              <span style={{ marginLeft: 12 }}>Phiếu thu chi</span>
              <Segmented<'A4' | 'A5'> value={t.paper_size_voucher} onChange={(v) => set({ paper_size_voucher: v })} options={['A4', 'A5']} />
            </Space>
          </section>
          <section>
            <h4>Cột trên phiếu</h4>
            <Space direction="vertical">
              <label>
                <Switch size="small" checked={!t.hide_code_column} onChange={(v) => set({ hide_code_column: !v })} /> In cột Mã hàng
              </label>
              <label>
                <Switch size="small" checked={!t.hide_unit_column} onChange={(v) => set({ hide_unit_column: !v })} /> In cột ĐVT
              </label>
            </Space>
          </section>
          <section>
            <h4>Dòng chân trang</h4>
            <Input.TextArea
              value={t.footer}
              maxLength={300}
              autoSize={{ minRows: 1, maxRows: 3 }}
              placeholder="Ví dụ: Cảm ơn quý khách! Hàng đã mua miễn đổi trả sau 7 ngày."
              onChange={(e) => set({ footer: e.target.value })}
              aria-label="Dòng chân trang"
            />
          </section>
          <section>
            <h4>Tên các ô ký</h4>
            <div className="muted" style={{ marginBottom: 4 }}>
              Gõ tên rồi Enter để thêm ô; bấm × để bỏ; 1–6 ô. Để trống = theo mặc định.
            </div>
            {SIGN_KEYS.map((k) => (
              <div key={k.key} className="tpl-sign-row">
                <span className="tpl-sign-label">{k.label}</span>
                <Select<string[]>
                  mode="tags"
                  style={{ flex: 1 }}
                  value={t.signatures[k.key] ?? []}
                  placeholder={(defaults[k.key] ?? []).join(' · ')}
                  maxCount={6}
                  tokenSeparators={[',']}
                  open={false}
                  onChange={(v) => set({ signatures: { ...t.signatures, [k.key]: v.map((x) => x.trim()).filter(Boolean).slice(0, 6) } })}
                  aria-label={`Ô ký ${k.label}`}
                />
              </div>
            ))}
          </section>
        </div>
        <div className="tpl-preview">
          <Segmented<'doc' | 'voucher'>
            value={preview}
            onChange={setPreview}
            options={[
              { value: 'doc', label: 'Phiếu bán (mẫu)' },
              { value: 'voucher', label: 'Phiếu thu (mẫu)' },
            ]}
          />
          <div className={`print-preview size-${preview === 'doc' ? t.paper_size_document : t.paper_size_voucher}`}>
            {preview === 'doc' ? <PrintSheet doc={SAMPLE_DOC} tplOverride={live} /> : <VoucherPrint v={SAMPLE_VOUCHER} tplOverride={live} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function strip(t: PrintTemplate): Omit<PrintTemplate, 'has_logo' | 'logo_type' | 'logo_updated_at'> {
  const sig: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(t.signatures)) if (v && v.length) sig[k] = v;
  return {
    paper_size_document: t.paper_size_document,
    paper_size_voucher: t.paper_size_voucher,
    footer: t.footer ?? '',
    hide_unit_column: !!t.hide_unit_column,
    hide_code_column: !!t.hide_code_column,
    signatures: sig,
  };
}

// ---------- Nhật ký thay đổi ----------
const ENTITY_LABEL: Record<string, string> = {
  document: 'Chứng từ kho',
  voucher: 'Phiếu thu chi',
  product: 'Mặt hàng',
  partner: 'Đối tác',
  product_group: 'Nhóm hàng',
  warehouse: 'Kho',
  cash_account: 'Tài khoản tiền',
  features: 'Tính năng mở rộng',
  role_permissions: 'Phân quyền',
  period_lock: 'Khóa sổ',
  import: 'Nhập từ Excel',
  partner_prices: 'Bảng giá riêng',
  settings: 'Thông tin công ty',
  print_template: 'Mẫu in',
  product_units: 'Đơn vị quy đổi',
  vat_settings: 'Thuế suất mặc định',
};
const ACTION_LABEL: Record<string, string> = {
  created: 'Tạo',
  updated: 'Sửa',
  deleted: 'Xóa',
  posted: 'Ghi sổ',
  unposted: 'Bỏ ghi sổ',
  imported: 'Nhập',
  credit_confirmed: 'Xác nhận vượt hạn mức',
  logo_updated: 'Đổi logo',
  logo_deleted: 'Bỏ logo',
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const show = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '(trống)' : typeof v === 'boolean' ? (v ? 'có' : 'không') : typeof v === 'number' ? v.toLocaleString('vi-VN') : typeof v === 'string' ? v : Array.isArray(v) ? `${v.length} mục` : '…';
const FIELD_LABEL: Record<string, string> = {
  code: 'mã',
  name: 'tên',
  unit: 'ĐVT',
  sale_price: 'giá bán',
  purchase_price: 'giá mua',
  active: 'đang dùng',
  address: 'địa chỉ',
  phone: 'điện thoại',
  tax_code: 'MST',
  note: 'ghi chú',
  doc_date: 'ngày',
  total_amount: 'tổng tiền',
  status: 'trạng thái',
  min_stock: 'tồn tối thiểu',
  credit_limit: 'hạn mức nợ',
  payment_days: 'số ngày được nợ',
  vat_rate: 'thuế suất',
  opening_receivable: 'nợ phải thu đầu kỳ',
  opening_payable: 'nợ phải trả đầu kỳ',
  opening_balance: 'số dư đầu kỳ',
  company_name: 'tên công ty',
  footer: 'chân trang',
};

/** Diễn giải một dòng nhật ký bằng lời thường. */
function describe(e: AuditEntry): string {
  const b = isObj(e.before) ? e.before : {};
  const a = isObj(e.after) ? e.after : {};
  if (e.entity === 'period_lock') {
    const reason = typeof a.reason === 'string' && a.reason ? ` — lý do: ${a.reason}` : '';
    return a.lock_date ? `Khóa sổ đến ${formatDate(String(a.lock_date))}${b.lock_date ? ` (trước: ${formatDate(String(b.lock_date))})` : ''}${reason}` : `Bỏ khóa sổ${reason}`;
  }
  if (e.entity === 'features') {
    const fa = isObj(a.features) ? a.features : a;
    const fb = isObj(b.features) ? b.features : b;
    const ch = Object.keys(fa).filter((k) => fa[k] !== fb[k]);
    return ch.length ? ch.map((k) => `${fa[k] ? 'bật' : 'tắt'} ${k}`).join(', ') : 'Đổi tính năng';
  }
  if (e.entity === 'role_permissions') {
    const ma = isObj(a.matrix) ? a.matrix : a;
    return `Đổi quyền vai trò ${Object.keys(ma)
      .map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r)
      .join(', ')}`;
  }
  if (e.entity === 'document' || e.entity === 'voucher') {
    const no = (a.doc_no ?? a.display_no ?? a.voucher_no ?? b.doc_no ?? b.display_no ?? b.voucher_no ?? '') as string;
    const t = (a.doc_type ?? b.doc_type) as keyof typeof DOC_TYPE_LABEL | undefined;
    const kind = t && DOC_TYPE_LABEL[t] ? DOC_TYPE_LABEL[t] : e.entity === 'voucher' ? ((a.voucher_type_name ?? b.voucher_type_name) as string) || 'Phiếu thu chi' : 'Chứng từ';
    const money = typeof a.total_amount === 'number' && typeof b.total_amount === 'number' && a.total_amount !== b.total_amount ? ` · tổng ${show(b.total_amount)} → ${show(a.total_amount)}` : '';
    return `${kind} ${no}${money}`.trim();
  }
  const name = (a.code ?? b.code ?? a.name ?? b.name ?? '') as string;
  const changed = Object.keys(FIELD_LABEL).filter((k) => k in a && k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const det = changed.length ? `: ${changed.map((k) => `${FIELD_LABEL[k]} ${show(b[k])} → ${show(a[k])}`).join('; ')}` : '';
  if (e.entity === 'vat_settings') return `Thuế suất mặc định ${show(b.default_vat_rate ?? 'KCT')} → ${show(a.default_vat_rate ?? 'KCT')}`;
  if (e.entity === 'print_template') return e.action.startsWith('logo') ? '' : 'Đổi mẫu in';
  if (e.entity === 'import') return `Nhập từ Excel${isObj(a) && a.kind ? ` (${String(a.kind)})` : ''}${typeof a.rows === 'number' ? ` — ${a.rows} dòng` : ''}`;
  return `${name}${det}`;
}

export function AuditPage() {
  const [entity, setEntity] = useState<string | undefined>();
  const [userId, setUserId] = useState<number | undefined>();
  const [range, setRange] = useState<DateRangeValue>({ preset: 'all', range: [null, null] });
  const [page, setPage] = useState(1);
  const [from, to] = rangeOf(range);
  const users = useQuery({ queryKey: ['catalog', 'user', 'list', {}], queryFn: () => usersApi.list() });
  const params: AuditParams = useMemo(
    () => ({ entity, user_id: userId, from: toApiDate(from), to: toApiDate(to), limit: 100, offset: (page - 1) * 100 }),
    [entity, userId, from?.valueOf(), to?.valueOf(), page], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => setPage(1), [entity, userId, from?.valueOf(), to?.valueOf()]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ['audit', params], queryFn: () => auditApi.list(params) });
  const columns: ColumnsType<AuditEntry> = [
    { title: 'Lúc', dataIndex: 'at', width: 150, render: (s: string) => formatDateTime(s) },
    { title: 'Người làm', dataIndex: 'user_name', width: 170, ellipsis: true, render: (s: string | null) => s ?? <span className="muted">(hệ thống)</span> },
    { title: 'Loại', dataIndex: 'entity', width: 150, render: (s: string) => ENTITY_LABEL[s] ?? s },
    { title: 'Việc', dataIndex: 'action', width: 120, render: (s: string) => <Tag>{ACTION_LABEL[s] ?? s}</Tag> },
    { title: 'Chi tiết', key: 'd', ellipsis: { showTitle: true }, render: (_, e) => describe(e) },
  ];
  return (
    <div className="list-page">
      <PageHeader title="Nhật ký thay đổi" sub="Mọi thay đổi dữ liệu: ai làm, lúc nào, đổi gì (mới nhất trước). Chỉ xem, không sửa được." />
      <div className="toolbar">
        <Select<string>
          allowClear
          placeholder="Mọi loại"
          style={{ width: 200 }}
          value={entity}
          onChange={setEntity}
          options={Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label }))}
          aria-label="Lọc theo loại"
        />
        <Select<number>
          allowClear
          placeholder="Mọi người"
          style={{ width: 200 }}
          value={userId}
          onChange={setUserId}
          options={(users.data?.items ?? []).map((u) => ({ value: u.id, label: u.full_name }))}
          aria-label="Lọc theo người"
        />
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <div className="table-wrap" style={{ overflow: 'auto' }}>
        <Table<AuditEntry>
          size="small"
          rowKey="id"
          loading={q.isLoading}
          dataSource={q.data?.items ?? []}
          columns={columns}
          tableLayout="fixed"
          pagination={{ current: page, pageSize: 100, total: q.data?.total ?? 0, onChange: setPage, showSizeChanger: false, showTotal: (t) => `${t} dòng` }}
          locale={{ emptyText: q.isError ? errorMessage(q.error) : 'Không có thay đổi nào khớp bộ lọc.' }}
        />
      </div>
    </div>
  );
}

export { todayVn };
