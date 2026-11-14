import { useSettings } from '../../api/hooks';
import type { Voucher } from '../../api/types';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { moneyInWords } from '../../lib/numberWords';
import { VOUCHER_TITLE } from './voucherText';

/** Bản in phiếu thu / phiếu chi (khổ A5), có dòng "Bằng chữ". In từ dữ liệu đã lưu. */
export function VoucherPrint({ v }: { v: Voucher }) {
  const co = useSettings().data;
  const receipt = v.voucher_type === 'receipt';
  const signers = receipt
    ? ['Giám đốc', 'Kế toán trưởng', 'Người nộp tiền', 'Người lập phiếu', 'Thủ quỹ']
    : ['Giám đốc', 'Kế toán trưởng', 'Thủ quỹ', 'Người lập phiếu', 'Người nhận tiền'];
  return (
    <div className="print-sheet voucher-sheet">
      {co && (co.company_name || co.company_address) && (
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
      <div className="ps-title">{VOUCHER_TITLE[v.voucher_type][v.account_kind]}</div>
      <div className="ps-meta">
        Số: <b>{v.voucher_no}</b> &nbsp;·&nbsp; Ngày {formatDate(v.voucher_date)} &nbsp;·&nbsp; {v.account_name}
      </div>
      <table className="ps-info">
        <tbody>
          <tr>
            <td>{receipt ? 'Họ tên người nộp tiền:' : 'Họ tên người nhận tiền:'}</td>
            <td>
              <b>{v.partner_name ?? '……………………………………'}</b>
            </td>
          </tr>
          {v.partner_address?.trim() && (
            <tr>
              <td>Địa chỉ:</td>
              <td>{v.partner_address.trim()}</td>
            </tr>
          )}
          <tr>
            <td>{receipt ? 'Lý do nộp:' : 'Lý do chi:'}</td>
            <td>{v.note || (v.lines.length === 1 ? v.lines[0]?.description : '')}</td>
          </tr>
        </tbody>
      </table>
      <table className="ps-lines">
        <thead>
          <tr>
            <th style={{ width: '7%' }}>STT</th>
            <th>Diễn giải</th>
            <th style={{ width: '20%' }}>Chứng từ liên quan</th>
            <th style={{ width: '22%' }}>Số tiền</th>
          </tr>
        </thead>
        <tbody>
          {v.lines.map((l) => (
            <tr key={l.id}>
              <td className="c">{l.line_no}</td>
              <td>{l.description}</td>
              <td className="c">{l.document_no ?? ''}</td>
              <td className="r">{formatMoney(l.amount)}</td>
            </tr>
          ))}
          <tr className="ps-sum">
            <td colSpan={3}>Tổng số tiền</td>
            <td className="r">{formatMoney(v.total_amount)}</td>
          </tr>
        </tbody>
      </table>
      <div className="ps-words">
        Bằng chữ: <i>{moneyInWords(v.total_amount)}</i>
      </div>
      <div className="ps-words">Kèm theo: ……… chứng từ gốc.</div>
      <div className="ps-date">Ngày …… tháng …… năm ………</div>
      <div className="ps-signs ps-signs-5">
        {signers.map((s) => (
          <div key={s}>
            <b>{s}</b>
            <div className="ps-sign-hint">(Ký, họ tên)</div>
          </div>
        ))}
      </div>
      <div className="ps-foot">
        In lúc {formatDateTime(new Date().toISOString())} · Lập bởi {v.created_by_name}
      </div>
    </div>
  );
}
