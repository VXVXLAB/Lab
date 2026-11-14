import { forwardRef, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Input, Tooltip, type InputRef } from 'antd';
import { formatMoney, formatQty, parseVnNumber } from '../lib/format';

export interface NumberInputProps {
  value?: number | null;
  onChange?: (v: number | null) => void;
  /** money: tối đa 2 số lẻ · qty: tối đa 3 số lẻ */
  kind?: 'money' | 'qty';
  allowNegative?: boolean;
  placeholder?: string;
  disabled?: boolean;
  style?: CSSProperties;
  className?: string;
  id?: string;
  suffix?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  status?: 'error' | 'warning';
  'aria-label'?: string;
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Ô nhập số theo thói quen kế toán Việt Nam (xem `parseVnNumber`):
 * gõ `1.500.000`, `1500000`, `1,5tr`, `150k`, `2,5` hoặc `2.5` (bàn phím số) đều được.
 * Đang gõ giữ nguyên chữ người dùng gõ; rời ô ⇒ định dạng lại `1.500.000`.
 * Vào ô ⇒ bôi đen toàn bộ để gõ đè.
 */
export const NumberInput = forwardRef<InputRef, NumberInputProps>(function NumberInput(
  { value, onChange, kind = 'money', allowNegative = false, style, onBlur, suffix, status, ...rest },
  ref,
) {
  const digits = kind === 'qty' ? 3 : 2;
  const fmt = (n: number | null | undefined) => (kind === 'qty' ? formatQty(n) : formatMoney(n));
  const [text, setText] = useState(() => fmt(value));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const justFocused = useRef(false);

  // Giá trị từ ngoài đổi (form reset, tải bản ghi) khi không gõ ⇒ hiển thị lại.
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const commit = (raw: string) => {
    const n = parseVnNumber(raw);
    if (n === null) {
      setInvalid(false);
      onChange?.(null);
      return;
    }
    if (Number.isNaN(n) || (!allowNegative && n < 0)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange?.(roundTo(n, digits));
  };

  const errorText = !allowNegative && text.trim().startsWith('-') ? 'Không được nhập số âm' : 'Số chưa đúng. Ví dụ: 1.500.000 hoặc 2,5';

  return (
    <Tooltip open={focused && invalid} title={errorText} placement="topRight" color="#a8071a">
      <Input
        {...rest}
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        status={invalid ? 'error' : status}
        style={{ textAlign: 'right', ...style }}
        suffix={suffix ? <span className="num-suffix">{suffix}</span> : undefined}
        onFocus={(e) => {
          setFocused(true);
          // Bôi đen ngay (đồng bộ) để gõ đè — không dùng setTimeout vì người gõ nhanh sẽ bị mất số đầu.
          e.target.select();
          justFocused.current = true;
        }}
        onMouseUp={(e) => {
          // Bấm chuột vào ô: giữ phần bôi đen thay vì để trình duyệt đặt con trỏ giữa chữ.
          if (justFocused.current) e.preventDefault();
          justFocused.current = false;
        }}
        onKeyDown={() => {
          justFocused.current = false;
        }}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => {
          // Rời ô: hiển thị lại giá trị hợp lệ cuối cùng (gõ sai thì quay về số cũ).
          setFocused(false);
          setInvalid(false);
          setText(fmt(value));
          onBlur?.();
        }}
      />
    </Tooltip>
  );
});
