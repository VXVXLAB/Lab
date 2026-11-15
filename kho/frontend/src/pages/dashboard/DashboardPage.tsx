import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Skeleton, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { dashboardApi, partnersApi, productsApi } from '../../api/catalog';
import { documentsApi } from '../../api/documents';
import { settingsApi } from '../../api/reports';
import { storage } from '../../lib/storage';
import { useState } from 'react';

const HIDE_KEY = 'kho.onboardHidden';
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

/** Hướng dẫn bắt đầu cho CSDL mới: tự đánh dấu bước đã xong theo dữ liệu thật; ẩn khi xong hết hoặc người dùng tắt. */
function Onboarding() {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => storage.get(HIDE_KEY) === '1');
  const s = useQuery({
    queryKey: ['catalog', 'onboarding'],
    queryFn: async () => {
      const [settings, goods, cust, supp, opening, sales] = await Promise.all([
        settingsApi.get(),
        productsApi.list({ is_service: false, page_size: 1 }),
        partnersApi.list({ type: 'customer', page_size: 1 }),
        partnersApi.list({ type: 'supplier', page_size: 1 }),
        documentsApi.list({ type: 'opening', status: 'posted', page_size: 1 }),
        documentsApi.list({ type: 'sale', page_size: 1 }),
      ]);
      return {
        company: !!settings.company_name.trim(),
        goods: goods.total > 0,
        partners: cust.total > 0 && supp.total > 0,
        opening: opening.total > 0,
        sales: sales.total > 0,
      };
    },
    staleTime: 60_000,
    enabled: !hidden,
  });
  const d = s.data;
  if (hidden || !d || Object.values(d).every(Boolean)) return null;
  const steps = [
    { done: d.company, title: 'Nhập thông tin công ty', desc: 'Tên, địa chỉ, MST in ở đầu mọi phiếu (người quản trị).', to: paths.company },
    { done: d.goods, title: 'Danh mục hàng hóa', desc: 'Mã, tên, ĐVT, giá bán, giá mua.', to: paths.products },
    { done: d.partners, title: 'Khách hàng và nhà cung cấp', desc: 'Kèm nợ phải thu / phải trả đầu kỳ nếu có.', to: d.goods ? paths.customers : paths.products },
    { done: d.opening, title: 'Tồn đầu kỳ', desc: 'Mỗi kho một phiếu tồn đầu, rồi Ghi sổ.', to: paths.opening },
    { done: d.sales, title: 'Bắt đầu bán hàng', desc: 'Lập phiếu bán đầu tiên (F2).', to: paths.sales },
  ];
  return (
    <div className="onboard">
      <h3>
        Bắt đầu sử dụng — làm lần lượt các bước sau{' '}
        <Button
          size="small"
          type="link"
          onClick={() => {
            storage.set(HIDE_KEY, '1');
            setHidden(true);
          }}
        >
          Ẩn hướng dẫn này
        </Button>
        <Button size="small" type="link" onClick={() => navigate(paths.guide)}>
          Xem hướng dẫn đầy đủ
        </Button>
      </h3>
      <ol>
        {steps.map((st, i) => (
          <li key={st.title} className={st.done ? 'done' : undefined}>
            <span className="step-n">{st.done ? '✓' : i + 1}</span>
            <span>
              <Button type="link" size="small" className="link-cell" onClick={() => navigate(st.to)}>
                {st.title}
              </Button>
              <div className="step-desc">{st.done ? 'Đã xong' : st.desc}</div>
            </span>
          </li>
        ))}
      </ol>
    </div>
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

      <Onboarding />
      <div className="tiles">
        <Tile
          label="Phiếu tạm đang treo"
          value={d.draft_count}
          sub={d.draft_count ? `${d.draft_sale_count} phiếu bán chưa ghi sổ` : 'Không có phiếu nào đang treo'}
          tone={d.draft_count ? 'warn' : 'default'}
          to={paths.drafts}
        />
        {/* số bị che (bản mở rộng, thiếu quyền xem) ⇒ không hiện ô đó */}
        {d.revenue_today !== null && <Tile label="Doanh thu hôm nay" value={money(d.revenue_today)} sub="Bán − khách trả, đã ghi sổ" to={paths.sales} />}
        {d.revenue_month !== null && (
          <Tile label={`Doanh thu tháng ${month}`} value={money(d.revenue_month)} sub="Từ đầu tháng đến hôm nay" to={paths.reports} />
        )}
        <Tile
          label={d.low_stock_rule === 'min_stock' ? 'Hàng dưới mức tối thiểu' : 'Hàng sắp hết'}
          value={d.low_stock_count}
          sub={
            <>
              {d.out_of_stock_count} mã hết hàng · {d.low_stock_rule === 'min_stock' ? 'tồn ≤ tồn tối thiểu từng mã' : `tồn ≤ ${d.low_stock_threshold}`}
              {d.draft_shortage_count > 0 && (
                <>
                  <br />
                  <span className="bad">{d.draft_shortage_count} mã thiếu cho phiếu bán tạm</span>
                </>
              )}
            </>
          }
          tone={d.out_of_stock_count > 0 ? 'bad' : d.low_stock_count > 0 || d.draft_shortage_count > 0 ? 'warn' : 'good'}
          to={d.draft_shortage_count > 0 ? paths.reorder : d.low_stock_rule === 'min_stock' ? paths.lowStock : paths.stock}
        />
        {d.total_receivable !== null && <Tile label="Khách hàng còn nợ (phải thu)" value={money(d.total_receivable)} to={paths.receivable} />}
        {d.total_payable !== null && <Tile label="Còn nợ nhà cung cấp (phải trả)" value={money(d.total_payable)} to={paths.payable} />}
        {d.cash_balance !== null && (
          <Tile label="Tiền mặt tồn quỹ" value={money(d.cash_balance)} tone={d.cash_balance < 0 ? 'bad' : 'default'} to={paths.cashBook} />
        )}
        {d.bank_balance !== null && (
          <Tile label="Tiền gửi ngân hàng" value={money(d.bank_balance)} tone={d.bank_balance < 0 ? 'bad' : 'default'} to={paths.cashBook} />
        )}
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
            { title: 'Tổng tiền', dataIndex: 'total_amount', width: 130, align: 'right', render: (n: number | null) => (n === null ? <span className="muted">—</span> : formatMoney(n)) },
            { title: 'Người sửa cuối', dataIndex: 'updated_by_name', width: 200 },
            { title: 'Lúc', dataIndex: 'updated_at', width: 135, render: (s: string) => formatDateTime(s) },
          ]}
        />
      </div>
    </div>
  );
}
