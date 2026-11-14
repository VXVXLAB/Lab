import type { DocumentFull } from '../../api/types';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../lib/format';
import { DOC_TYPES } from './docTypes';
import { useSettings } from '../../api/hooks';

const SIGNERS: Record<DocumentFull['doc_type'], string[]> = {
  sale: ['Người lập phiếu', 'Người giao hàng', 'Khách hàng', 'Thủ kho'],
  sale_return: ['Người lập phiếu', 'Khách hàng', 'Thủ kho'],
  purchase: ['Người lập phiếu', 'Người giao hàng', 'Thủ kho'],
  purchase_return: ['Người lập phiếu', 'Người nhận hàng', 'Thủ kho'],
  transfer: ['Người lập phiếu', 'Thủ kho xuất', 'Thủ kho nhận'],
  opening: ['Người lập phiếu', 'Thủ kho'],
};

/**
 * Bản in phiếu (A4/A5 qua hộp thoại in của trình duyệt). Luôn in từ dữ liệu ĐÃ LƯU trên máy chủ.
 * Phiếu tạm in tiêu đề "PHIẾU TẠM (chưa ghi sổ)"; phiếu chính thức chỉ có khi đã ghi sổ.
 */
export function PrintSheet({ doc }: { doc: DocumentFull }) {
  const cfg = DOC_TYPES[doc.doc_type];
  const co = useSettings().data;
  const draft = doc.status === 'draft';
  const no = draft ? doc.draft_no : (doc.doc_no ?? doc.display_no);
  const hasNotes = doc.lines.some((l) => l.note);
  const goodsQty = doc.lines.filter((l) => !l.is_service).reduce((s, l) => s + l.qty, 0);
  return (
    <div className="print-sheet">
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
            <th style={{ width: '15%' }}>Mã hàng</th>
            <th>Tên hàng</th>
            <th style={{ width: '8%' }}>ĐVT</th>
            <th style={{ width: '11%' }}>Số lượng</th>
            {cfg.hasPrice && <th style={{ width: '13%' }}>Đơn giá</th>}
            {cfg.hasPrice && <th style={{ width: '14%' }}>Thành tiền</th>}
            {hasNotes && <th style={{ width: '14%' }}>Ghi chú</th>}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td className="c">{l.line_no}</td>
              <td>{l.is_service ? 'DICHVU' : l.product_code}</td>
              <td>{l.is_service ? l.description : l.description || l.product_name}</td>
              <td className="c">{l.unit}</td>
              <td className="r">{formatQty(l.qty, true)}</td>
              {cfg.hasPrice && <td className="r">{l.unit_price === null ? '' : formatMoney(l.unit_price)}</td>}
              {cfg.hasPrice && <td className="r">{l.unit_price === null ? '' : formatMoney(l.amount)}</td>}
              {hasNotes && <td>{l.note}</td>}
            </tr>
          ))}
          <tr className="ps-sum">
            <td colSpan={4}>Cộng</td>
            <td className="r">{cfg.hasPrice ? '' : formatQty(goodsQty, true)}</td>
            {cfg.hasPrice && <td />}
            {cfg.hasPrice && <td className="r">{formatMoney(doc.total_amount)}</td>}
            {hasNotes && <td />}
          </tr>
        </tbody>
      </table>
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
        {SIGNERS[doc.doc_type].map((s) => (
          <div key={s}>
            <b>{s}</b>
            <div className="ps-sign-hint">(Ký, ghi rõ họ tên)</div>
          </div>
        ))}
      </div>
      <div className="ps-foot">
        In lúc {formatDateTime(new Date().toISOString())} · {draft ? 'Phiếu tạm' : `Ghi sổ bởi ${doc.posted_by_name ?? ''}`}
      </div>
    </div>
  );
}
