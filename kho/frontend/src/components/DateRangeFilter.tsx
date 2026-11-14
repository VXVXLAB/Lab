import { Select } from 'antd';
import type { Dayjs } from 'dayjs';
import { formatDate, todayVn } from '../lib/format';
import { DateInput } from './DateInput';

export type Preset = 'all' | 'today' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'custom';
export interface DateRangeValue {
  preset: Preset;
  range: [Dayjs | null, Dayjs | null];
}

const LABEL: Record<Preset, string> = {
  today: 'Hôm nay',
  week: 'Tuần này',
  month: 'Tháng này',
  lastMonth: 'Tháng trước',
  quarter: 'Quý này',
  year: 'Năm nay',
  all: 'Tất cả',
  custom: 'Khoảng ngày…',
};

export function presetRange(p: Preset): [Dayjs | null, Dayjs | null] {
  const t = todayVn();
  switch (p) {
    case 'today':
      return [t, t];
    case 'week':
      return [t.subtract((t.day() + 6) % 7, 'day'), t];
    case 'month':
      return [t.startOf('month'), t];
    case 'lastMonth': {
      const m = t.subtract(1, 'month');
      return [m.startOf('month'), m.endOf('month')];
    }
    case 'quarter': {
      const q0 = Math.floor(t.month() / 3) * 3;
      return [t.month(q0).startOf('month'), t];
    }
    case 'year':
      return [t.startOf('year'), t];
    default:
      return [null, null];
  }
}

/** Câu mô tả khoảng ngày cho tiêu đề in: "Từ 01/04/2026 đến 31/05/2026" / "Toàn bộ thời gian". */
export function describeRange(v: DateRangeValue): string {
  const [f, t] = rangeOf(v);
  if (!f && !t) return 'Toàn bộ thời gian';
  if (f && t) return `Từ ${formatDate(f)} đến ${formatDate(t)}`;
  return f ? `Từ ${formatDate(f)}` : `Đến ${formatDate(t)}`;
}

/** Khoảng ngày thực tế đang chọn. */
export function rangeOf(v: DateRangeValue): [Dayjs | null, Dayjs | null] {
  return v.preset === 'custom' ? v.range : presetRange(v.preset);
}

export function DateRangeFilter({
  value,
  onChange,
  presets = ['today', 'week', 'month', 'lastMonth', 'quarter', 'year', 'all', 'custom'],
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  presets?: Preset[];
}) {
  const [from, to] = rangeOf(value);
  return (
    <span className="range">
      <Select<Preset>
        aria-label="Khoảng thời gian"
        value={value.preset}
        style={{ width: 132 }}
        options={presets.map((p) => ({ value: p, label: LABEL[p] }))}
        onChange={(p) => onChange({ preset: p, range: p === 'custom' ? rangeOf(value) : value.range })}
      />
      {value.preset === 'custom' ? (
        <>
          <DateInput value={value.range[0]} onChange={(d) => onChange({ ...value, range: [d, value.range[1]] })} style={{ width: 130 }} placeholder="Từ ngày" />
          <span className="muted">→</span>
          <DateInput value={value.range[1]} onChange={(d) => onChange({ ...value, range: [value.range[0], d] })} style={{ width: 130 }} placeholder="Đến ngày" />
        </>
      ) : (
        from && (
          <span className="muted range-text">
            {formatDate(from)} – {formatDate(to)}
          </span>
        )
      )}
    </span>
  );
}
