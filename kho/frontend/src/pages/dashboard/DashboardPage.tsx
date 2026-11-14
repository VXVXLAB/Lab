import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Skeleton, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { dashboardApi } from '../../api/catalog';
import { errorMessage } from '../../api/client';
import { qk } from '../../api/queryKeys';
import type { RecentDraft } from '../../api/types';
import { formatDate, formatDateTime, formatLongDate, formatMoney, formatTime } from '../../lib/format';
import { DOC_TYPE_LABEL } from '../../lib/labels';
import { PageHeader } from '../../components/PageHeader';
import { paths } from '../../paths';

interface TileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'warn' | 'bad' | 'good';
  to?: string;
}

function Tile({ label, value, sub, tone = 'default', to }: TileProps) {
  const navigate = useNavigate();
  const content = (
    <>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </>
  );
  return to ? (
    <button type="button" className={`tile tile-${tone} tile-link`} onClick={() => navigate(to)}>
      {content}
    </button>
  ) : (
    <div className={`tile tile-${tone}`}>{content}</div>
  );
}

function money(n: number) {
  return (
    <>
      {formatMoney(n)}
      <span className="unit"> đ</span>
    </>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: qk.dashboard, queryFn: () => dashboardApi.get(), refetchInterval: 5 * 60_000 });

  if (q.isLoading) {
    return (
      <div className="dash">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="Không tải được số liệu tổng quan"
        description={errorMessage(q.error)}
        action={<Button onClick={() => void q.refetch()}>Thử lại</Button>}
      />
    );
  }
  const d = q.data;
  const month = formatDate(d.today).slice(3);

  return (
    <div className="dash">
      <PageHeader
        title="Tổng quan"
        sub={
          <>
            {formatLongDate(d.today)} · số liệu lúc {formatTime(d.generated_at)} (tự cập nhật khi có phiếu mới)
          </>
        }
        actions={
          <Button icon={<ReloadOutlined />} onClick={() => void q.refetch()} loading={q.isFetching}>
            Làm mới
          </Button>
        }
      />

      <div className="tiles">
        <Tile
          label="Phiếu tạm đang treo"
          value={d.draft_count}
          sub={d.draft_count ? `${d.draft_sale_count} phiếu bán chưa ghi sổ` : 'Không có phiếu nào đang treo'}
          tone={d.draft_count ? 'warn' : 'default'}
          to={paths.drafts}
        />
        <Tile label="Doanh thu hôm nay" value={money(d.revenue_today)} sub="Bán − khách trả, đã ghi sổ" to={paths.sales} />
        <Tile label={`Doanh thu tháng ${month}`} value={money(d.revenue_month)} sub="Từ đầu tháng đến hôm nay" to={paths.reports} />
        <Tile
          label="Hàng sắp hết"
          value={d.low_stock_count}
          sub={
            <>
              {d.out_of_stock_count} mã hết hàng · tồn ≤ {d.low_stock_threshold}
              {d.draft_shortage_count > 0 && (
                <>
                  <br />
                  <span className="bad">{d.draft_shortage_count} mã thiếu cho phiếu bán tạm</span>
                </>
              )}
            </>
          }
          tone={d.out_of_stock_count > 0 ? 'bad' : d.low_stock_count > 0 || d.draft_shortage_count > 0 ? 'warn' : 'good'}
          to={d.draft_shortage_count > 0 ? paths.reorder : paths.stock}
        />
        <Tile label="Khách hàng còn nợ (phải thu)" value={money(d.total_receivable)} to={paths.receivable} />
        <Tile label="Còn nợ nhà cung cấp (phải trả)" value={money(d.total_payable)} to={paths.payable} />
        <Tile label="Tiền mặt tồn quỹ" value={money(d.cash_balance)} tone={d.cash_balance < 0 ? 'bad' : 'default'} to={paths.cashBook} />
        <Tile label="Tiền gửi ngân hàng" value={money(d.bank_balance)} tone={d.bank_balance < 0 ? 'bad' : 'default'} to={paths.cashBook} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Phiếu tạm đang treo {d.recent_drafts.length > 0 && <span className="count">{d.draft_count}</span>}</h3>
          <span className="muted">Phiếu do mọi máy lập, chưa ghi sổ — bấm vào phiếu để mở và làm tiếp</span>
          <Button type="link" onClick={() => navigate(paths.drafts)}>
            Xem tất cả
          </Button>
        </div>
        <Table<RecentDraft>
          size="small"
          rowKey="document_id"
          pagination={false}
          dataSource={d.recent_drafts}
          locale={{ emptyText: 'Không có phiếu tạm nào — mọi phiếu đã ghi sổ.' }}
          onRow={(r) => ({ onClick: () => navigate(paths.document(r.document_id)), className: 'row-link' })}
          columns={[
            { title: 'Số tạm', dataIndex: 'draft_no', width: 110, className: 'col-code' },
            {
              title: 'Loại phiếu',
              dataIndex: 'doc_type',
              width: 150,
              render: (t: RecentDraft['doc_type']) => <Tag color={t === 'sale' ? 'blue' : t === 'purchase' ? 'purple' : 'default'}>{DOC_TYPE_LABEL[t]}</Tag>,
            },
            { title: 'Ngày phiếu', dataIndex: 'doc_date', width: 105, render: (s: string) => formatDate(s) },
            { title: 'Khách hàng / Nhà cung cấp', dataIndex: 'partner_name', render: (s: string | null) => s ?? <span className="muted">–</span> },
            { title: 'Tổng tiền', dataIndex: 'total_amount', width: 130, align: 'right', render: (n: number) => formatMoney(n) },
            { title: 'Người sửa cuối', dataIndex: 'updated_by_name', width: 200 },
            { title: 'Lúc', dataIndex: 'updated_at', width: 135, render: (s: string) => formatDateTime(s) },
          ]}
        />
      </div>
    </div>
  );
}
