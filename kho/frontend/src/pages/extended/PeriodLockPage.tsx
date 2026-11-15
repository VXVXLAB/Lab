import { useState } from 'react';
import { App, Alert, Button, Input, Skeleton, Space, Table } from 'antd';
import { LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { errorMessage } from '../../api/client';
import { periodLockApi } from '../../api/extended';
import type { PeriodLock } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { DateInput } from '../../components/DateInput';
import { PageHeader } from '../../components/PageHeader';
import { formatDate, formatDateTime, toApiDate, todayVn } from '../../lib/format';
import { qkPeriodLock } from '../../lib/periodLock';

/** Hệ thống › Khóa sổ (chỉ quản trị; tính năng "Khóa sổ" bật). */
export function PeriodLockPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const q = useQuery({ queryKey: qkPeriodLock, queryFn: periodLockApi.get });
  const [date, setDate] = useState<Dayjs | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cur = q.data?.lock_date ?? null;

  const send = async (lock: string | null) => {
    setErr(null);
    try {
      const r = await periodLockApi.set(lock, reason.trim());
      qc.setQueryData<PeriodLock>(qkPeriodLock, (old) => ({ ...old, ...r }));
      void qc.invalidateQueries({ queryKey: qkPeriodLock });
      await refresh();
      setReason('');
      setDate(null);
      message.success(lock ? `Đã khóa sổ đến ${formatDate(lock)}` : 'Đã bỏ khóa sổ', 2);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const lock = () => {
    const d = toApiDate(date);
    if (!d) return setErr('Chọn ngày khóa sổ');
    if (date && date.isAfter(todayVn(), 'day')) return setErr('Không khóa sổ được ngày trong tương lai');
    if (!reason.trim()) return setErr('Ghi lý do (ví dụ "Chốt sổ tháng 10") để sau này tra lại');
    const back = cur && d < cur;
    modal.confirm({
      title: back ? `Lùi ngày khóa sổ về ${formatDate(d)}?` : `Khóa sổ đến ${formatDate(d)}?`,
      content: back
        ? `Các phiếu từ ${formatDate(d)} đến ${formatDate(cur)} sẽ sửa được trở lại.`
        : `Mọi phiếu kho và phiếu thu chi có ngày từ ${formatDate(d)} trở về trước sẽ không tạo, sửa, ghi sổ, bỏ ghi sổ, xóa được nữa. Phiếu tạm trong kỳ vẫn sửa/xóa được nhưng không ghi sổ được.`,
      okText: back ? 'Lùi ngày khóa' : 'Khóa sổ',
      cancelText: 'Thôi',
      onOk: () => send(d),
    });
  };
  const unlock = () => {
    if (!reason.trim()) return setErr('Ghi lý do bỏ khóa sổ');
    modal.confirm({
      title: 'Bỏ khóa sổ?',
      content: 'Mọi phiếu sẽ sửa được như trước. Có thể khóa lại bất cứ lúc nào.',
      okText: 'Bỏ khóa sổ',
      okButtonProps: { danger: true },
      cancelText: 'Thôi',
      onOk: () => send(null),
    });
  };

  if (q.isLoading) return <Skeleton active />;
  return (
    <div className="lock-page">
      <PageHeader title="Khóa sổ" sub="Chốt số liệu đến một ngày: phiếu từ ngày đó trở về trước không ai sửa được nữa (kể cả quản trị, trừ khi lùi ngày khóa)." />
      {q.isError && <Alert type="error" showIcon message={errorMessage(q.error)} />}
      <div className="lock-current">
        {cur ? (
          <>
            <LockOutlined /> Đang khóa sổ đến hết ngày <b>{formatDate(cur)}</b>
          </>
        ) : (
          <>
            <UnlockOutlined /> Chưa khóa sổ
          </>
        )}
      </div>
      <div className="lock-form">
        <label htmlFor="lock_date">Khóa sổ đến ngày</label>
        <DateInput id="lock_date" value={date} onChange={setDate} style={{ width: 160 }} />
        <label htmlFor="lock_reason">Lý do</label>
        <Input id="lock_reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: Chốt sổ tháng 10/2026" maxLength={200} style={{ width: 320 }} />
        <Space>
          <Button type="primary" icon={<LockOutlined />} onClick={lock}>
            {cur ? 'Đổi ngày khóa' : 'Khóa sổ'}
          </Button>
          {cur && (
            <Button danger icon={<UnlockOutlined />} onClick={unlock}>
              Bỏ khóa sổ
            </Button>
          )}
        </Space>
      </div>
      {err && <Alert style={{ marginTop: 10, maxWidth: 640 }} type="error" showIcon message={err} />}
      <h3 style={{ marginTop: 24 }}>Lịch sử khóa sổ</h3>
      {q.data?.history?.length ? (
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          pagination={false}
          dataSource={q.data.history}
          columns={[
            { title: 'Lúc', dataIndex: 'at', width: 150, render: (v: string) => formatDateTime(v) },
            { title: 'Người làm', dataIndex: 'user_name', width: 200 },
            {
              title: 'Thay đổi',
              key: 'chg',
              width: 260,
              render: (_, h) => (
                <>
                  {h.old_lock_date ? formatDate(h.old_lock_date) : 'Chưa khóa'} → <b>{h.new_lock_date ? formatDate(h.new_lock_date) : 'Bỏ khóa'}</b>
                </>
              ),
            },
            { title: 'Lý do', dataIndex: 'reason', render: (r?: string) => r || <span className="muted">–</span> },
          ]}
        />
      ) : (
        <div className="muted">Chưa có lần khóa sổ nào.</div>
      )}
    </div>
  );
}
