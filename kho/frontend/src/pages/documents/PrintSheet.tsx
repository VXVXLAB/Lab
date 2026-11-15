import { useDocAccess } from '../../auth/guard';
import type { DocumentFull } from '../../api/types';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../lib/format';
import { useSettings } from '../../api/hooks';
import { signersOf, usePrintTemplate, type ActiveTemplate } from '../../lib/printTemplate';
import { PrintLogo, PrintFooter } from '../../components/PrintExtras';

const SIGNERS: Record<DocumentFull['doc_type'], string[]> = {
  sale: ['Người lập phiếu', 'Người giao hàng', 'Khách hàng', 'Thủ kho'],
  sale_return: ['Người lập phiếu', 'Khách hàng', 'Thủ kho'],
  purchase: ['Người lập phiếu', 'Người giao hàng', 'Thủ kho'],
  purchase_return: ['Người lập phiếu', 'Người nhận hàng', 'Thủ kho'],
  transfer: ['Người lập phiếu', 'Thủ kho xuất', 'Thủ kho nhận'],
  opening: ['Người lập phiếu', 'Thủ kho'],
  stocktake: ['Người lập phiếu', 'Thủ kho', 'Kế toán'],
};

/**
 * Bản in phiếu (A4/A5 qua hộp thoại in của trình duyệt). Luôn in từ dữ liệu ĐÃ LƯU trên máy chủ.
 * Phiếu tạm in tiêu đề "PHIẾU TẠM (chưa ghi sổ)"; phiếu chính thức chỉ có khi đã ghi sổ.
 */
export function PrintSheet({ doc, tplOverride }: { doc: DocumentFull; /** Xem trước mẫu in chưa lưu (màn Mẫu in) */ tplOverride?: ActiveTemplate | null }) {
  // bản mở rộng: giá vốn / công nợ bị che ⇒ bỏ cột giá, Nợ cũ/Tổng nợ (khớp file xuất của máy chủ)
  const cfg = useDocAccess(doc.doc_type).cfg;
  const co = useSettings().data;
  const draft = doc.status === 'draft';
  const no = draft ? doc.draft_no : (doc.doc_no ?? doc.display_no);
  const hasNotes = doc.lines.some((l) => l.note);
  const goodsQty = doc.lines.filter((l) => !l.is_service).reduce((s, l) => s + l.qty, 0);
  // ---- bản mở rộng M3 ----
  const tplSaved = usePrintTemplate();
  const tpl = tplOverride !== undefined ? tplOverride : tplSaved;
  const showCode = !tpl?.template.hide_code_column;
  const showUnit = !tpl?.template.hide_unit_column;
  const stocktake = doc.doc_type === 'stocktake';
  /** Phiếu có thuế (C11): cột Thuế suất, Tiền thuế; dòng Cộng tiền hàng / Tiền thuế / Tổng thanh toán */
  const vat = cfg.hasPrice && doc.lines.some((l) => l.vat_rate !== undefined && l.vat_rate !== null);
  const lead = 2 + (showCode ? 1 : 0) + (showUnit ? 1 : 0); // số cột trước cột Số lượng
  const signers = signersOf(tpl, doc.doc_type, SIGNERS[doc.doc_type]);
  if (stocktake) return <StocktakePrint doc={doc} co={co} tpl={tpl} showCode={showCode} showUnit={showUnit} signers={signers} />;
  return (
    <div className="print-sheet">
      <PrintLogo tpl={tpl} />
      {co && (co.company_name || co.company_address || co.company_phone || co.company_tax_code) && (
        <div className="ps-company">
          {co.company_name && <div className="ps-company-name">{co.company_name}</div>}
          {co.company_address && <div>Địa chỉ: {co.company_address}</div>}
          {(co.company_phone || co.company_tax_code) && (
            <div>
              {co.company_phone && <>Điện thoại: {co.company_phone}</>}
              {co.company_phone && co.company_tax_code && <>&nbsp;&nbsp;&nbsp;&nbsp;</>}
              {co.company_tax_code && <>MST: {co.company_tax_code}</>}
            </div>
          )}
        </div>
      )}
      <div className="ps-title">{draft ? 'PHIẾU TẠM (chưa ghi sổ)' : cfg.printTitle}</div>
      {draft && <div className="ps-subtitle">{cfg.name} — chưa ghi sổ, chưa trừ/cộng kho, chưa vào công nợ</div>}
      <div className="ps-meta">
        Số: <b>{no}</b> &nbsp;·&nbsp; Ngày: <b>{formatDate(doc.doc_date)}</b>
      </div>
      <table className="ps-info">
        <tbody>
          {cfg.partner && (
            <>
              <tr>
                <td>{cfg.partnerLabel}:</td>
                <td>
                  <b>{doc.partner_name}</b>
                  {doc.partner_code && <span> ({doc.partner_code})</span>}
                </td>
              </tr>
              {/* bỏ phần trống (F-09): chỉ địa chỉ ⇒ "Địa chỉ: …"; chỉ ĐT ⇒ "ĐT: …"; không có cả hai ⇒ không có dòng */}
              {doc.partner_address?.trim() ? (
                <tr>
                  <td>Địa chỉ:</td>
                  <td>
                    {doc.partner_address.trim()}
                    {doc.partner_phone?.trim() && <> · ĐT: {doc.partner_phone.trim()}</>}
                  </td>
                </tr>
              ) : doc.partner_phone?.trim() ? (
                <tr>
                  <td>ĐT:</td>
                  <td>{doc.partner_phone.trim()}</td>
                </tr>
              ) : null}
            </>
          )}
          <tr>
            <td>{cfg.warehouseLabel}:</td>
            <td>
              {doc.warehouse_name}
              {cfg.toWarehouse && <> → Kho nhận: {doc.to_warehouse_name}</>}
            </td>
          </tr>
          {doc.note && (
            <tr>
              <td>Ghi chú:</td>
              <td>{doc.note}</td>
            </tr>
          )}
        </tbody>
      </table>
      <table className="ps-lines">
        <thead>
          <tr>
            <th style={{ width: '5%' }}>STT</th>
            {showCode && <th style={{ width: '15%' }}>Mã hàng</th>}
            <th>Tên hàng</th>
            {showUnit && <th style={{ width: '8%' }}>ĐVT</th>}
            <th style={{ width: '11%' }}>Số lượng</th>
            {cfg.hasPrice && <th style={{ width: '13%' }}>Đơn giá</th>}
            {cfg.hasPrice && <th style={{ width: '14%' }}>Thành tiền</th>}
            {vat && <th style={{ width: '7%' }}>Thuế suất</th>}
            {vat && <th style={{ width: '11%' }}>Tiền thuế</th>}
            {hasNotes && <th style={{ width: '14%' }}>Ghi chú</th>}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td className="c">{l.line_no}</td>
              {showCode && <td>{l.is_service ? 'DICHVU' : l.product_code}</td>}
              <td>{l.is_service ? l.description : l.description || l.product_name}</td>
              {showUnit && <td className="c">{l.unit}</td>}
              <td className="r">{formatQty(l.qty, true)}</td>
              {cfg.hasPrice && <td className="r">{l.unit_price === null ? '' : formatMoney(l.unit_price)}</td>}
              {cfg.hasPrice && <td className="r">{l.unit_price === null ? '' : formatMoney(l.amount)}</td>}
              {vat && <td className="c">{l.vat_rate === null || l.vat_rate === undefined ? 'KCT' : `${l.vat_rate}%`}</td>}
              {vat && <td className="r">{l.tax_amount ? formatMoney(l.tax_amount) : ''}</td>}
              {hasNotes && <td>{l.note}</td>}
            </tr>
          ))}
          <tr className="ps-sum">
            <td colSpan={lead}>{vat ? 'Cộng tiền hàng' : 'Cộng'}</td>
            <td className="r">{cfg.hasPrice ? '' : formatQty(goodsQty, true)}</td>
            {cfg.hasPrice && <td />}
            {cfg.hasPrice && <td className="r">{formatMoney(vat ? (doc.goods_amount ?? doc.total_amount) : doc.total_amount)}</td>}
            {vat && <td />}
            {vat && <td className="r">{formatMoney(doc.tax_amount)}</td>}
            {hasNotes && <td />}
          </tr>
          {vat && (
            <tr className="ps-sum">
              <td colSpan={lead + 3}>Tổng thanh toán</td>
              <td />
              <td className="r">{formatMoney(doc.total_amount)}</td>
              {hasNotes && <td />}
            </tr>
          )}
        </tbody>
      </table>
      {vat && doc.amount_in_words && (
        <div className="ps-words">
          Bằng chữ: <i>{doc.amount_in_words}</i>
        </div>
      )}
      {cfg.hasDebt && doc.old_debt !== null && (
        <table className="ps-debt">
          <tbody>
            <tr>
              <td>Nợ cũ:</td>
              <td className="r">{formatMoney(doc.old_debt)}</td>
            </tr>
            <tr>
              <td>
                <b>Tổng nợ (đến ngày {formatDate(doc.doc_date)}):</b>
              </td>
              <td className="r">
                <b>{formatMoney(doc.total_debt)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <div className="ps-date">Ngày …… tháng …… năm ………</div>
      <div className="ps-signs">
        {signers.map((s) => (
          <div key={s}>
            <b>{s}</b>
            <div className="ps-sign-hint">(Ký, ghi rõ họ tên)</div>
          </div>
        ))}
      </div>
      <PrintFooter tpl={tpl} />
      <div className="ps-foot">
        In lúc {formatDateTime(new Date().toISOString())} · {draft ? 'Phiếu tạm' : `Ghi sổ bởi ${doc.posted_by_name ?? ''}`}
      </div>
    </div>
  );
}

/** Biên bản kiểm kê (C9): Tồn sổ sách / Thực tế / Chênh lệch, theo đơn vị đã chọn trên dòng. */
function StocktakePrint({
  doc,
  co,
  tpl,
  showCode,
  showUnit,
  signers,
}: {
  doc: DocumentFull;
  co: ReturnType<typeof useSettings>['data'];
  tpl: ReturnType<typeof usePrintTemplate>;
  showCode: boolean;
  showUnit: boolean;
  signers: string[];
}) {
  const draft = doc.status === 'draft';
  const f = (l: DocumentFull['lines'][number]) => l.factor ?? 1;
  const book = (l: DocumentFull['lines'][number]) => (l.book_qty === null || l.book_qty === undefined ? null : l.book_qty / f(l));
  const diff = (l: DocumentFull['lines'][number]) => (book(l) === null ? null : l.qty - (book(l) ?? 0));
  return (
    <div className="print-sheet">
      <PrintLogo tpl={tpl} />
      {co?.company_name && (
        <div className="ps-company">
          <div className="ps-company-name">{co.company_name}</div>
          {co.company_address && <div>Địa chỉ: {co.company_address}</div>}
        </div>
      )}
      <div className="ps-title">BIÊN BẢN KIỂM KÊ KHO{draft ? ' (chưa ghi sổ)' : ''}</div>
      <div className="ps-meta">
        Số: <b>{draft ? doc.draft_no : (doc.doc_no ?? doc.display_no)}</b> &nbsp;·&nbsp; Ngày kiểm kê: <b>{formatDate(doc.doc_date)}</b> &nbsp;·&nbsp; Kho:{' '}
        <b>{doc.warehouse_name}</b>
      </div>
      {doc.note && <div className="ps-meta">Ghi chú: {doc.note}</div>}
      <table className="ps-lines">
        <thead>
          <tr>
            <th style={{ width: '5%' }}>STT</th>
            {showCode && <th style={{ width: '15%' }}>Mã hàng</th>}
            <th>Tên hàng</th>
            {showUnit && <th style={{ width: '8%' }}>ĐVT</th>}
            <th style={{ width: '12%' }}>Tồn sổ sách</th>
            <th style={{ width: '12%' }}>Thực tế</th>
            <th style={{ width: '12%' }}>Chênh lệch</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => {
            const d = diff(l);
            return (
              <tr key={l.id}>
                <td className="c">{l.line_no}</td>
                {showCode && <td>{l.product_code}</td>}
                <td>{l.product_name}</td>
                {showUnit && <td className="c">{l.unit}</td>}
                <td className="r">{book(l) === null ? '' : formatQty(book(l), true)}</td>
                <td className="r">{formatQty(l.qty, true)}</td>
                <td className="r">{d === null || d === 0 ? '' : `${d > 0 ? '+' : ''}${formatQty(d, true)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="ps-date">Ngày …… tháng …… năm ………</div>
      <div className="ps-signs">
        {signers.map((s) => (
          <div key={s}>
            <b>{s}</b>
            <div className="ps-sign-hint">(Ký, ghi rõ họ tên)</div>
          </div>
        ))}
      </div>
      <PrintFooter tpl={tpl} />
      <div className="ps-foot">
        In lúc {formatDateTime(new Date().toISOString())} · {draft ? 'Phiếu tạm' : `Ghi sổ bởi ${doc.posted_by_name ?? ''}`}
      </div>
    </div>
  );
}
