import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import { Button, Calendar, Input, Popover, Tooltip, type InputRef } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { dayjs, DATE_FORMAT, todayVn } from '../lib/format';

/**
 * Đọc ngày gõ tắt kiểu kế toán: `25/9/2026`, `25/09/26`, `25.9`, `2509` (năm nay), `250926`, `25092026`, `25` (tháng này).
 * Trả null nếu không hiểu.
 */
export function parseVnDate(input: string, base: Dayjs = todayVn()): Dayjs | null {
  const s = input.trim();
  if (!s) return null;
  let d: number;
  let m: number;
  let y: number;
  const digits = s.replace(/\D/g, '');
  if (/^\d+$/.test(s)) {
    if (s.length <= 2) [d, m, y] = [Number(s), base.month() + 1, base.year()];
    else if (s.length === 4) [d, m, y] = [Number(s.slice(0, 2)), Number(s.slice(2, 4)), base.year()];
    else if (s.length === 6) [d, m, y] = [Number(s.slice(0, 2)), Number(s.slice(2, 4)), 2000 + Number(s.slice(4))];
    else if (s.length === 8) [d, m, y] = [Number(s.slice(0, 2)), Number(s.slice(2, 4)), Number(s.slice(4))];
    else return null;
  } else {
    const parts = s.split(/[/.\-\s]+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 3 || !digits) return null;
    d = Number(parts[0]);
    m = Number(parts[1]);
    y = parts[2] === undefined ? base.year() : Number(parts[2]);
    if (parts[2] !== undefined && parts[2].length <= 2) y += 2000;
  }
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  const r = dayjs(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, 'YYYY-MM-DD', true);
  return r.isValid() ? r : null;
}

export interface DateInputProps {
  value?: Dayjs | null;
  onChange?: (d: Dayjs | null) => void;
  id?: string;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Ô ngày gõ bằng bàn phím (không bật lịch khi vào ô — Enter đi tiếp như mọi ô khác).
 * Nút lịch bên phải để chọn bằng chuột.
 */
export const DateInput = forwardRef<InputRef, DateInputProps>(function DateInput(
  { value, onChange, id, style, disabled, placeholder = 'dd/mm/yyyy' },
  ref,
) {
  const [text, setText] = useState(value ? value.format(DATE_FORMAT) : '');
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!focused) setText(value ? value.format(DATE_FORMAT) : '');
  }, [value, focused]);

  const commit = (raw: string) => {
    const d = parseVnDate(raw);
    if (!raw.trim()) {
      setBad(false);
      onChange?.(null);
    } else if (d) {
      setBad(false);
      if (!value || !d.isSame(value, 'day')) onChange?.(d);
    } else setBad(true);
  };

  return (
    <Tooltip open={focused && bad} title="Ngày chưa đúng. Gõ ví dụ 25/9/2026 hoặc 250926" color="#a8071a">
      <Input
        ref={ref}
        id={id}
        style={style}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        status={bad ? 'error' : undefined}
        autoComplete="off"
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const d = parseVnDate(e.target.value);
          setBad(!!e.target.value.trim() && !d);
          // gõ đủ ngày (vd. 25/9/2026, 250926) ⇒ nhận ngay để Ctrl+S không bỏ sót
          if (d && /\d{4}$|^\d{6}$/.test(e.target.value.trim()) && (!value || !d.isSame(value, 'day'))) onChange?.(d);
        }}
        onKeyDown={(e) => {
          // chốt giá trị trước khi Enter đưa sang ô khác
          if (e.key === 'Enter') commit(text);
        }}
        onBlur={() => {
          commit(text);
          setFocused(false);
          setBad(false);
        }}
        suffix={
          <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottomRight"
            content={
              <div style={{ width: 290 }}>
                <Calendar
                  fullscreen={false}
                  value={value ?? todayVn()}
                  onSelect={(d, info) => {
                    if (info.source === 'date') {
                      onChange?.(d);
                      setOpen(false);
                    }
                  }}
                />
              </div>
            }
          >
            <Button
              type="text"
              size="small"
              tabIndex={-1}
              icon={<CalendarOutlined />}
              aria-label="Chọn ngày trên lịch"
              disabled={disabled}
              style={{ marginRight: -6 }}
            />
          </Popover>
        }
      />
    </Tooltip>
  );
});
