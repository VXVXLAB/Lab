// Khóa sổ (bản mở rộng, C4): ngày khóa hiện tại và nhãn/cảnh báo dùng ở phiếu.
import { Tag, Tooltip } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { periodLockApi } from '../api/extended';
import { useFeature } from '../auth/AuthContext';
import { formatDate, fromApiDate } from './format';

export const qkPeriodLock = ['period-lock'] as const;

/** Ngày khóa sổ đang áp dụng (null: chưa khóa hoặc tính năng tắt — khi tắt KHÔNG gọi máy chủ). */
export function useLockDate(): string | null {
  const on = useFeature('period_lock');
  const q = useQuery({ queryKey: qkPeriodLock, queryFn: periodLockApi.get, enabled: on, staleTime: 60_000 });
  return on ? (q.data?.lock_date ?? null) : null;
}

/** Ngày `d` (YYYY-MM-DD hoặc Dayjs) có nằm trong kỳ đã khóa không. */
export function isLocked(d: string | Dayjs | null | undefined, lockDate: string | null): boolean {
  if (!d || !lockDate) return false;
  const s = typeof d === 'string' ? d : d.format('YYYY-MM-DD');
  return s <= lockDate;
}

export const lockedText = (lockDate: string) => `Đã khóa sổ đến ${formatDate(lockDate)}`;

/** Nhãn "Đã khóa sổ đến dd/mm/yyyy" trên phiếu thuộc kỳ đã khóa. */
export function LockBadge({ lockDate, title }: { lockDate: string; title?: string }) {
  return (
    <Tooltip title={title ?? 'Phiếu thuộc kỳ đã khóa sổ: không sửa, không ghi sổ, không xóa được. Muốn sửa, nhờ quản trị lùi ngày khóa sổ.'}>
      <Tag icon={<LockOutlined />} color="purple" className="lock-badge">
        {lockedText(lockDate)}
      </Tag>
    </Tooltip>
  );
}

export const lockTooltip = (lockDate: string) => `${lockedText(lockDate)} — không làm được việc này với phiếu trong kỳ đã khóa`;

/** Dòng cảnh báo dưới ô ngày khi chọn ngày trong kỳ đã khóa. */
export function lockDateWarning(d: Dayjs | null, lockDate: string | null): string | null {
  if (!d || !lockDate || !isLocked(d, lockDate)) return null;
  return `Ngày này thuộc kỳ đã khóa sổ (đến ${formatDate(lockDate)}) — phiếu sẽ không lưu / ghi sổ được.`;
}

/** Gợi ý dưới ô số dư đầu kỳ khi đang khóa sổ (máy chủ không cho đổi). */
export const lockedOpeningHint = (lockDate: string) =>
  `Đang khóa sổ đến ${formatDate(lockDate)}: không đổi được số dư đầu kỳ. Nhờ quản trị bỏ khóa sổ trước (Hệ thống › Khóa sổ).`;

export { fromApiDate };
