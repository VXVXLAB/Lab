import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/vi';
import utc from 'dayjs/plugin/utc';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(customParseFormat);
dayjs.locale('vi');

// ---------- Số ----------
const moneyFmt = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const qtyFmt1 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 3 });

/** Tiền: `1.234.567`; có số lẻ thì hiện số lẻ (`13.001,5`). null/undefined ⇒ chuỗi rỗng. */
export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return moneyFmt.format(n);
}

/** Số lượng: `1.250,5`. `minOneDecimal` ⇒ `50,0` như mẫu phiếu của khách. */
export function formatQty(n: number | null | undefined, minOneDecimal = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return (minOneDecimal ? qtyFmt1 : qtyFmt).format(n);
}

/**
 * Đọc số theo thói quen gõ của kế toán Việt Nam. Trả `null` nếu trống, `NaN` nếu không hiểu.
 * - `.` là dấu nghìn, `,` là dấu thập phân: `1.234.567`, `1.234,5`.
 * - Bàn phím số chỉ có `.`: một dấu `.` mà sau nó KHÔNG đúng 3 chữ số ⇒ là dấu thập phân (`1.5` = 1,5);
 *   đúng 3 chữ số (`1.500`) ⇒ dấu nghìn như cách viết Việt Nam.
 * - Khoảng trắng, `đ`, `₫` bị bỏ qua. Hậu tố `k` = nghìn, `tr` = triệu (`150k`, `1,5tr`).
 * - Dấu `-` ở đầu (hoặc trong ngoặc) là số âm.
 */
export function parseVnNumber(input: string): number | null {
  let s = input.trim().toLowerCase().replace(/[\s₫đ]/g, '').replace(/vnd$/, '');
  if (s === '') return null;
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  let mult = 1;
  if (s.endsWith('tr')) {
    mult = 1_000_000;
    s = s.slice(0, -2);
  } else if (s.endsWith('k')) {
    mult = 1_000;
    s = s.slice(0, -1);
  }
  if (s === '' || !/^[\d.,]+$/.test(s)) return Number.NaN;

  let normalized: string;
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas > 1) return Number.NaN;
  if (commas === 1) {
    // `,` là thập phân, mọi `.` là dấu nghìn
    const [intPart, frac] = s.split(',') as [string, string];
    if (dots > 0 && !/^\d{1,3}(\.\d{3})*$/.test(intPart)) return Number.NaN;
    normalized = `${intPart.replace(/\./g, '')}.${frac}`;
  } else if (dots === 0) {
    normalized = s;
  } else if (dots === 1) {
    const [a, b] = s.split('.') as [string, string];
    normalized = b.length === 3 && a.length > 0 && a !== '0' ? `${a}${b}` : `${a || '0'}.${b}`;
  } else {
    if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return Number.NaN;
    normalized = s.replace(/\./g, '');
  }
  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1);
  const n = Number(normalized);
  if (!Number.isFinite(n)) return Number.NaN;
  const v = n * mult;
  return neg ? -v : v;
}

// ---------- Ngày ----------
/** Định dạng hiển thị và các kiểu gõ tắt được chấp nhận ở ô ngày. */
export const DATE_FORMAT = 'DD/MM/YYYY';
export const DATE_INPUT_FORMATS = [DATE_FORMAT, 'D/M/YYYY', 'DD/MM/YY', 'D/M/YY', 'DDMMYYYY', 'DDMMYY'];
const VN_OFFSET_MINUTES = 7 * 60;

/** `2026-11-14` ⇒ `14/11/2026`. */
export function formatDate(d: string | Dayjs | null | undefined): string {
  if (!d) return '';
  const x = typeof d === 'string' ? dayjs(d.slice(0, 10), 'YYYY-MM-DD') : d;
  return x.isValid() ? x.format(DATE_FORMAT) : '';
}

/** Thời điểm RFC 3339 UTC ⇒ giờ Việt Nam `14/11/2026 20:58`. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const x = dayjs.utc(iso).utcOffset(VN_OFFSET_MINUTES);
  return x.isValid() ? x.format('DD/MM/YYYY HH:mm') : '';
}

/** Chỉ giờ:phút theo giờ Việt Nam. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const x = dayjs.utc(iso).utcOffset(VN_OFFSET_MINUTES);
  return x.isValid() ? x.format('HH:mm') : '';
}

/** Gửi lên máy chủ: `YYYY-MM-DD`. */
export function toApiDate(d: Dayjs | null | undefined): string | undefined {
  return d && d.isValid() ? d.format('YYYY-MM-DD') : undefined;
}

/** `YYYY-MM-DD` từ máy chủ ⇒ Dayjs cho DatePicker. */
export function fromApiDate(s: string | null | undefined): Dayjs | null {
  if (!s) return null;
  const d = dayjs(s.slice(0, 10), 'YYYY-MM-DD');
  return d.isValid() ? d : null;
}

/** Hôm nay theo giờ Việt Nam (máy trạm có thể đặt múi giờ sai). */
export function todayVn(): Dayjs {
  const now = dayjs.utc().utcOffset(VN_OFFSET_MINUTES);
  return dayjs(now.format('YYYY-MM-DD'), 'YYYY-MM-DD');
}

/** "Thứ Bảy, 14/11/2026" */
export function formatLongDate(s: string): string {
  const d = fromApiDate(s);
  if (!d) return '';
  const wd = d.locale('vi').format('dddd');
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${d.format(DATE_FORMAT)}`;
}

export { dayjs };
