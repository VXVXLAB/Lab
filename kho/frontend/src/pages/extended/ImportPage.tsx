import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, App, Button, Input, Progress, Radio, Select, Space, Table, Tag } from 'antd';
import { CheckCircleOutlined, DownloadOutlined, FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { ApiError, errorMessage } from '../../api/client';
import { importApi } from '../../api/extended';
import type { ImportKind, ImportResult, Permission } from '../../api/types';
import { useAccess, type Access } from '../../auth/AuthContext';
import { DateInput } from '../../components/DateInput';
import { PageHeader } from '../../components/PageHeader';
import { download } from '../../lib/download';
import { formatDate, toApiDate, todayVn } from '../../lib/format';
import { lockDateWarning, useLockDate } from '../../lib/periodLock';
import { matchText } from '../../lib/text';
import { paths } from '../../paths';

const KINDS: { key: ImportKind; label: string; what: string; cols: string }[] = [
  { key: 'products', label: 'Hàng hóa', what: 'Thêm mặt hàng mới, sửa tên / ĐVT / nhóm / giá của mặt hàng đã có (theo mã).', cols: 'Mã hàng, Tên hàng, ĐVT, Nhóm VTHH, Giá bán, Giá mua' },
  { key: 'partners', label: 'Khách hàng, nhà cung cấp', what: 'Thêm đối tác mới, sửa thông tin đối tác đã có (theo mã).', cols: 'Mã đối tác, Tên đối tác, Là KH, Là NCC, Địa chỉ, Điện thoại, MST' },
  { key: 'opening_stock', label: 'Tồn đầu kỳ', what: 'Tạo phiếu Tồn đầu kỳ TẠM (mỗi kho một phiếu) để bạn xem lại rồi ghi sổ.', cols: 'Mã hàng, Mã kho, Số lượng, Đơn giá' },
  { key: 'opening_debt', label: 'Công nợ đầu kỳ', what: 'Đặt số phải thu / phải trả đầu kỳ của từng đối tác (thay số cũ).', cols: 'Mã đối tác, Phải thu, Phải trả' },
  {
    key: 'partner_prices',
    label: 'Bảng giá riêng',
    what: 'Thêm / sửa giá riêng của từng khách cho từng mã (theo mã khách + mã hàng). Giá riêng đã có mà không nằm trong file thì giữ nguyên.',
    cols: 'Mã khách hàng, Mã hàng, Giá, Ghi chú',
  },
  {
    key: 'product_units',
    label: 'Đơn vị quy đổi',
    what: 'Khai báo đơn vị quy đổi cho mặt hàng (vd. 1 Thùng = 24 Lon).',
    cols: 'Mã hàng, Đơn vị, Hệ số',
  },
];

/** Loại dữ liệu người dùng được nhập (dùng cả để ẩn mục menu khi không có loại nào). */
export function importKinds(a: Access, isAdmin: boolean): typeof KINDS {
  const can = (p: Permission) => isAdmin || a.permissions.has(p);
  return KINDS.filter((k) =>
    k.key === 'opening_debt'
      ? isAdmin
      : k.key === 'opening_stock'
        ? can('stock.write')
        : k.key === 'partner_prices'
          ? !!a.features.price_list && can('sale.write')
          : k.key === 'product_units'
            ? !!a.features.unit_conversion && can('catalog.write')
            : can('catalog.write'),
  );
}

type Phase = { s: 'idle' } | { s: 'checking'; pct: number } | { s: 'checked'; r: ImportResult } | { s: 'importing'; pct: number; r: ImportResult } | { s: 'done'; r: ImportResult };

/** Danh mục › Nhập từ Excel (tính năng "Nhập từ Excel"). */
export function ImportPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const a = useAccess();
  const lockDate = useLockDate();
  const kinds = importKinds(a, a.isAdmin);
  const [kind, setKind] = useState<ImportKind>(kinds[0]?.key ?? 'products');
  const [date, setDate] = useState<Dayjs | null>(todayVn());
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const [err, setErr] = useState<string | null>(null);
  const [colFilter, setColFilter] = useState<string | undefined>();
  const [textFilter, setTextFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cur = KINDS.find((k) => k.key === kind)!;

  const reset = () => {
    setPhase({ s: 'idle' });
    setErr(null);
    setColFilter(undefined);
    setTextFilter('');
  };

  const check = async (f: File, k = kind, d = date) => {
    reset();
    setPhase({ s: 'checking', pct: 0 });
    try {
      const r = await importApi.run(k, f, { dryRun: true, date: k === 'opening_stock' ? toApiDate(d) : undefined }, (pct) =>
        setPhase({ s: 'checking', pct }),
      );
      setPhase({ s: 'checked', r });
    } catch (e) {
      setPhase({ s: 'idle' });
      setErr(errorMessage(e));
    }
  };

  const run = async () => {
    if (phase.s !== 'checked' || !file) return;
    const before = phase.r;
    setPhase({ s: 'importing', pct: 0, r: before });
    try {
      const r = await importApi.run(kind, file, { dryRun: false, date: kind === 'opening_stock' ? toApiDate(date) : undefined }, (pct) =>
        setPhase({ s: 'importing', pct, r: before }),
      );
      setPhase({ s: 'done', r });
      void qc.invalidateQueries();
      message.success(`Đã nhập ${r.rows.toLocaleString('vi-VN')} dòng`, 2);
    } catch (e) {
      // còn lỗi (máy chủ kiểm lại) ⇒ hiện danh sách lỗi, chưa ghi gì
      if (e instanceof ApiError && e.code === 'IMPORT_INVALID' && e.details) setPhase({ s: 'checked', r: e.details as ImportResult });
      else {
        setPhase({ s: 'checked', r: before });
        setErr(errorMessage(e));
      }
    }
  };

  const r = phase.s === 'checked' || phase.s === 'importing' || phase.s === 'done' ? phase.r : null;
  const errors = useMemo(
    () => (r?.errors ?? []).filter((x) => (!colFilter || x.column === colFilter) && (!textFilter.trim() || matchText(textFilter, `${x.row} ${x.column} ${x.message}`))),
    [r, colFilter, textFilter],
  );
  const cols = useMemo(() => [...new Set((r?.errors ?? []).map((x) => x.column))], [r]);
  const busy = phase.s === 'checking' || phase.s === 'importing';
  const lockWarn = kind === 'opening_stock' ? lockDateWarning(date, lockDate) : null;

  if (!kinds.length) return <Alert type="info" showIcon message="Bạn không có quyền nhập dữ liệu nào. Hãy nhờ người quản trị." />;

  return (
    <div className="import-page">
      <PageHeader
        title="Nhập từ Excel"
        sub="Làm theo 3 bước. Phần mềm kiểm tra cả file trước; chỉ khi không còn lỗi mới nhập — và nhập tất cả hoặc không dòng nào."
      />

      <section className="import-step">
        <h3>
          <span className="step-no">1</span> Chọn loại dữ liệu và tải file mẫu
        </h3>
        <Radio.Group
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ImportKind);
            setFile(null);
            reset();
          }}
          optionType="button"
          buttonStyle="solid"
        >
          {kinds.map((k) => (
            <Radio.Button key={k.key} value={k.key}>
              {k.label}
            </Radio.Button>
          ))}
        </Radio.Group>
        <div className="import-what">{cur.what}</div>
        <div className="muted">
          Các cột: {cur.cols}. Cột có dấu * trong file mẫu là bắt buộc; thứ tự cột tùy ý; số gõ kiểu Việt (1.500.000; 2,5) được.
        </div>
        <Button icon={<DownloadOutlined />} onClick={() => download(importApi.templateUrl(kind))} style={{ marginTop: 8 }}>
          Tải file mẫu
        </Button>
        {kind === 'opening_stock' && (
          <div className="import-date">
            <label htmlFor="import_date">Ngày tồn đầu kỳ</label>
            <DateInput
              id="import_date"
              value={date}
              onChange={(d) => {
                setDate(d);
                if (file && d) void check(file, kind, d);
              }}
              style={{ width: 150 }}
            />
            {lockWarn && <div className="lock-warn">{lockWarn}</div>}
          </div>
        )}
        {kind === 'opening_debt' && lockDate && (
          <Alert
            style={{ marginTop: 8, maxWidth: 720 }}
            type="warning"
            showIcon
            message={`Đang khóa sổ đến ${formatDate(lockDate)}: công nợ đầu kỳ không đổi được. Bỏ khóa sổ trước (Hệ thống › Khóa sổ).`}
          />
        )}
      </section>

      <section className="import-step">
        <h3>
          <span className="step-no">2</span> Chọn file đã điền
        </h3>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          aria-label="Chọn file Excel"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            setFile(f);
            if (f) void check(f);
          }}
        />
        <Space wrap>
          <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} disabled={busy}>
            {file ? 'Chọn file khác' : 'Chọn file…'}
          </Button>
          {file && (
            <span>
              <FileExcelOutlined /> {file.name} <span className="muted">({(file.size / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} KB)</span>
            </span>
          )}
          {file && phase.s === 'checked' && (
            <Button onClick={() => void check(file)} size="small">
              Kiểm tra lại
            </Button>
          )}
        </Space>
        {phase.s === 'checking' && (
          <div className="import-progress">
            {phase.pct < 100 ? `Đang gửi file… ${phase.pct}%` : 'Đang kiểm tra từng dòng…'}
            <Progress percent={phase.pct < 100 ? phase.pct : 100} status="active" showInfo={false} />
          </div>
        )}
        {err && <Alert style={{ marginTop: 8, maxWidth: 720 }} type="error" showIcon message={err} />}
      </section>

      <section className="import-step">
        <h3>
          <span className="step-no">3</span> Xem kết quả kiểm tra rồi nhập
        </h3>
        {!r && <div className="muted">Chọn file ở bước 2 — phần mềm tự kiểm tra, chưa ghi gì.</div>}
        {r && (
          <>
            <div className="import-summary">
              <span>
                <b>{r.rows.toLocaleString('vi-VN')}</b> dòng dữ liệu
              </span>
              {kind !== 'opening_stock' && (
                <>
                  <span>
                    thêm mới <b>{r.creates.toLocaleString('vi-VN')}</b>
                  </span>
                  <span>
                    cập nhật <b>{r.updates.toLocaleString('vi-VN')}</b>
                  </span>
                </>
              )}
              {r.errors.length > 0 ? <Tag color="red">{r.errors.length.toLocaleString('vi-VN')} lỗi</Tag> : <Tag color="green">Không có lỗi</Tag>}
            </div>
            {(r.notes ?? []).map((n) => (
              <div key={n} className="muted">
                • {n}
              </div>
            ))}
            {r.errors.length > 0 && (
              <>
                <Alert
                  style={{ margin: '8px 0', maxWidth: 720 }}
                  type="error"
                  showIcon
                  message="Sửa các dòng dưới đây trong file Excel, lưu lại rồi bấm “Kiểm tra lại” (hoặc chọn lại file)."
                />
                <Space style={{ marginBottom: 6 }} wrap>
                  <Select
                    allowClear
                    placeholder="Mọi cột"
                    style={{ width: 180 }}
                    value={colFilter}
                    onChange={setColFilter}
                    options={cols.map((c) => ({ value: c, label: c || '(cả dòng)' }))}
                    aria-label="Lọc theo cột"
                  />
                  <Input.Search allowClear placeholder="Tìm trong lỗi…" style={{ width: 240 }} value={textFilter} onChange={(e) => setTextFilter(e.target.value)} />
                  <span className="muted">
                    {errors.length.toLocaleString('vi-VN')} / {r.errors.length.toLocaleString('vi-VN')} lỗi
                  </span>
                </Space>
                <Table
                  size="small"
                  className="import-errors"
                  rowKey={(x) => `${x.row}|${x.column}|${x.message}`}
                  dataSource={errors}
                  pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
                  columns={[
                    { title: 'Dòng', dataIndex: 'row', width: 70, align: 'right' },
                    { title: 'Cột', dataIndex: 'column', width: 160, render: (c: string) => c || <span className="muted">(cả dòng)</span> },
                    { title: 'Lỗi', dataIndex: 'message' },
                  ]}
                />
              </>
            )}
            {phase.s !== 'done' && (
              <Button
                type="primary"
                style={{ marginTop: 10 }}
                disabled={r.errors.length > 0 || r.rows === 0 || busy || !!lockWarn || (kind === 'opening_debt' && !!lockDate)}
                loading={phase.s === 'importing'}
                onClick={() => void run()}
              >
                Nhập {r.rows.toLocaleString('vi-VN')} dòng
              </Button>
            )}
            {phase.s === 'importing' && (
              <div className="import-progress">
                {phase.pct < 100 ? `Đang gửi file… ${phase.pct}%` : 'Đang ghi dữ liệu…'}
                <Progress percent={phase.pct < 100 ? phase.pct : 100} status="active" showInfo={false} />
              </div>
            )}
            {phase.s === 'done' && (
              <Alert
                style={{ marginTop: 10, maxWidth: 720 }}
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message={`Đã nhập xong ${r.rows.toLocaleString('vi-VN')} dòng.`}
                description={
                  r.documents?.length ? (
                    <>
                      Đã tạo {r.documents.length} phiếu Tồn đầu kỳ TẠM — mở từng phiếu, xem lại rồi bấm Ghi sổ (F9):
                      <ul style={{ margin: '4px 0 0' }}>
                        {r.documents.map((d) => (
                          <li key={d.id}>
                            <Link to={paths.document(d.id)}>
                              {d.draft_no} — kho {d.warehouse_code}, {d.lines.toLocaleString('vi-VN')} dòng
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : undefined
                }
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
