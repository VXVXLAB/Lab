import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Skeleton, Space, Table } from 'antd';
import { EditOutlined, FileExcelOutlined } from '@ant-design/icons';
import { errorMessage } from '../../api/client';
import { documentsApi } from '../../api/documents';
import { qk } from '../../api/queryKeys';
import type { DocumentLine } from '../../api/types';
import { download } from '../../lib/download';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../lib/format';
import { paths } from '../../paths';
import { DOC_TYPES } from '../documents/docTypes';
import { useDrawers } from './drawers';

/** Xem nhanh một chứng từ (chỉ đọc) trong ngăn kéo; có nút mở trình soạn để sửa. */
export function DocumentView({ id }: { id: number }) {
  const navigate = useNavigate();
  const drawers = useDrawers();
  const q = useQuery({ queryKey: qk.document(id), queryFn: () => documentsApi.get(id) });
  if (q.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (q.isError || !q.data) return <Alert type="error" showIcon message={errorMessage(q.error)} />;
  const d = q.data;
  const cfg = DOC_TYPES[d.doc_type];
  const posted = d.status === 'posted';
  return (
    <div className="doc-view">
      <div className="dv-top">
        <div>
          <div className="dv-type">{cfg.name}</div>
          <div className="dv-no">
            Số <b>{d.display_no}</b> · ngày <b>{formatDate(d.doc_date)}</b>
          </div>
        </div>
        <span className={`doc-status ${posted ? 'st-posted' : 'st-draft'}`}>{posted ? 'ĐÃ GHI SỔ' : 'PHIẾU TẠM — chưa ghi sổ'}</span>
        <Space style={{ marginLeft: 'auto' }}>
          <Button icon={<FileExcelOutlined />} onClick={() => download(documentsApi.exportUrl(d.id, 'xlsx'))}>
            Excel
          </Button>
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => {
              drawers.clear();
              navigate(paths.document(d.id));
            }}
          >
            Mở phiếu để sửa
          </Button>
        </Space>
      </div>
      <div className="dv-info">
        {cfg.partner && (
          <div>
            <span>{cfg.partnerLabel}</span>
            <b>{d.partner_name}</b> <span className="muted">{d.partner_code}</span>
            {(d.partner_address || d.partner_phone) && (
              <div className="muted">
                {d.partner_address} {d.partner_phone && `· ĐT ${d.partner_phone}`}
              </div>
            )}
          </div>
        )}
        <div>
          <span>{cfg.warehouseLabel}</span>
          <b>{d.warehouse_name}</b>
          {cfg.toWarehouse && <> → {d.to_warehouse_name}</>}
        </div>
        {d.note && (
          <div>
            <span>Ghi chú</span>
            {d.note}
          </div>
        )}
        <div className="muted dv-meta">
          Lập: {d.created_by_name} {formatDateTime(d.created_at)} · Sửa cuối: {d.updated_by_name} {formatDateTime(d.updated_at)}
          {d.posted_at && ` · Ghi sổ: ${d.posted_by_name} ${formatDateTime(d.posted_at)}`}
        </div>
      </div>
      <Table<DocumentLine>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={d.lines}
        columns={[
          { title: 'STT', dataIndex: 'line_no', width: 48, align: 'right' },
          {
            title: 'Mã hàng',
            dataIndex: 'product_code',
            width: 130,
            render: (c: string, l) =>
              l.is_service ? (
                <span className="service-code">DV</span>
              ) : (
                <Button
                  type="link"
                  size="small"
                  className="link-cell"
                  title="Xem thẻ kho mã này"
                  onClick={() => drawers.push({ kind: 'ledger', product: { id: l.product_id, code: l.product_code, name: l.product_name }, warehouseId: d.warehouse_id })}
                >
                  {c}
                </Button>
              ),
          },
          { title: 'Tên hàng / diễn giải', key: 'name', render: (_, l) => (l.is_service ? l.description : l.description || l.product_name) },
          { title: 'ĐVT', dataIndex: 'unit', width: 64 },
          { title: 'Số lượng', dataIndex: 'qty', width: 90, align: 'right', render: (n: number) => formatQty(n, true) },
          ...(cfg.hasPrice
            ? [
                { title: 'Đơn giá', dataIndex: 'unit_price', width: 110, align: 'right' as const, render: (n: number | null) => formatMoney(n) },
                { title: 'Thành tiền', dataIndex: 'amount', width: 120, align: 'right' as const, render: (n: number, l: DocumentLine) => (l.unit_price === null ? '' : formatMoney(n)) },
              ]
            : []),
          ...(d.lines.some((l) => l.note) ? [{ title: 'Ghi chú', dataIndex: 'note', width: 150 }] : []),
        ]}
      />
      <div className="dv-sums">
        {cfg.hasPrice && (
          <div>
            <span>Cộng</span>
            <b>{formatMoney(d.total_amount)}</b>
          </div>
        )}
        {cfg.hasDebt && d.old_debt !== null && (
          <>
            <div>
              <span>Nợ cũ</span>
              <b>{formatMoney(d.old_debt)}</b>
            </div>
            <div>
              <span>Tổng nợ đến {formatDate(d.doc_date)}</span>
              <b>{formatMoney(d.total_debt)}</b>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
