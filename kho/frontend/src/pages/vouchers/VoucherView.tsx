import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Skeleton, Space, Table } from 'antd';
import { EditOutlined, FileExcelOutlined } from '@ant-design/icons';
import { errorMessage } from '../../api/client';
import { qk } from '../../api/queryKeys';
import type { VoucherLine } from '../../api/types';
import { vouchersApi } from '../../api/vouchers';
import { download } from '../../lib/download';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { moneyInWords } from '../../lib/numberWords';
import { paths } from '../../paths';
import { useDrawers } from '../reports/drawers';
import { DEBT_EFFECT } from './voucherText';

/** Xem nhanh phiếu thu/chi (chỉ đọc) trong ngăn kéo. */
export function VoucherView({ id }: { id: number }) {
  const navigate = useNavigate();
  const drawers = useDrawers();
  const q = useQuery({ queryKey: qk.voucher(id), queryFn: () => vouchersApi.get(id) });
  if (q.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (q.isError || !q.data) return <Alert type="error" showIcon message={errorMessage(q.error)} />;
  const v = q.data;
  return (
    <div className="doc-view">
      <div className="dv-top">
        <div>
          <div className="dv-type">{v.voucher_type_name}</div>
          <div className="dv-no">
            Số <b>{v.voucher_no}</b> · ngày <b>{formatDate(v.voucher_date)}</b>
          </div>
        </div>
        <span className={`doc-status ${v.voucher_type === 'receipt' ? 'st-posted' : 'st-editing'}`}>{v.voucher_type === 'receipt' ? 'THU' : 'CHI'} {formatMoney(v.total_amount)} đ</span>
        <Space style={{ marginLeft: 'auto' }}>
          <Button icon={<FileExcelOutlined />} onClick={() => download(vouchersApi.exportUrl(v.id, 'xlsx'))}>
            Excel
          </Button>
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => {
              drawers.clear();
              navigate(paths.voucher(v.id));
            }}
          >
            Mở phiếu để sửa
          </Button>
        </Space>
      </div>
      <div className="dv-info">
        <div>
          <span>Tài khoản</span>
          <b>{v.account_name}</b> <span className="muted">{v.account_code}</span>
        </div>
        <div>
          <span>Đối tác</span>
          {v.partner_name ? (
            <>
              <b>{v.partner_name}</b> <span className="muted">{v.partner_code}</span>
              <div className="muted">{DEBT_EFFECT[v.voucher_type][v.debt_side]}</div>
            </>
          ) : (
            <span className="muted">Thu/chi khác — không vào công nợ</span>
          )}
        </div>
        {v.note && (
          <div>
            <span>Ghi chú / lý do</span>
            {v.note}
          </div>
        )}
        <div className="muted dv-meta">
          Lập: {v.created_by_name} {formatDateTime(v.created_at)} · Sửa cuối: {v.updated_by_name} {formatDateTime(v.updated_at)}
        </div>
      </div>
      <Table<VoucherLine>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={v.lines}
        columns={[
          { title: 'STT', dataIndex: 'line_no', width: 48, align: 'right' },
          { title: 'Diễn giải', dataIndex: 'description' },
          {
            title: 'Chứng từ liên quan',
            dataIndex: 'document_no',
            width: 150,
            render: (no: string | null, l) =>
              no && l.document_id ? (
                <Button type="link" size="small" className="link-cell" onClick={() => drawers.push({ kind: 'document', id: l.document_id!, title: `Chứng từ ${no}` })}>
                  {no}
                </Button>
              ) : (
                ''
              ),
          },
          { title: 'Số tiền', dataIndex: 'amount', width: 140, align: 'right', render: (n: number) => formatMoney(n) },
        ]}
      />
      <div className="dv-sums">
        <div>
          <span>Tổng tiền</span>
          <b>{formatMoney(v.total_amount)}</b>
        </div>
      </div>
      <div className="muted" style={{ textAlign: 'right' }}>
        Bằng chữ: <i>{moneyInWords(v.total_amount)}</i>
      </div>
    </div>
  );
}
