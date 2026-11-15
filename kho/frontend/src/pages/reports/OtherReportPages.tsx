import { useAccess, useCan } from '../../auth/AuthContext';
import { allowed, type Need } from '../../auth/guard';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  AppstoreOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SolutionOutlined,
  WalletOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { qk } from '../../api/queryKeys';
import { reportApi } from '../../api/reports';
import type { DraftDemandItem } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { formatDate, formatQty } from '../../lib/format';
import { useMenuHighlight } from '../../lib/menuHighlight';
import { paths } from '../../paths';
import { useDrawers } from './drawers';
import { TradeReportView } from './TradeReportView';

export function SalesReportPage() {
  useMenuHighlight(paths.reports, 'Chi tiết bán hàng');
  return (
    <div className="list-page">
      <TradeReportView kind="sales" pageTitle="Chi tiết bán hàng" pageSub="Từng dòng hàng đã bán (phiếu đã ghi sổ). Bấm dòng để xem phiếu." />
    </div>
  );
}

export function PurchasesReportPage() {
  useMenuHighlight(paths.reports, 'Chi tiết mua hàng');
  return (
    <div className="list-page">
      <TradeReportView kind="purchases" pageTitle="Chi tiết mua hàng" pageSub="Từng dòng hàng đã nhập mua (phiếu đã ghi sổ). Bấm dòng để xem phiếu." />
    </div>
  );
}

export function SalesHistoryPage() {
  useMenuHighlight(paths.reports, 'Lịch sử bán theo mặt hàng');
  return (
    <div className="list-page">
      <TradeReportView kind="sales" initialPreset="all" pageTitle="Lịch sử bán hàng theo mặt hàng" pageSub="Chọn mặt hàng để xem đã bán cho ai, ngày nào, giá bao nhiêu (mọi thời gian)." />
    </div>
  );
}

/** Hàng cần đặt (REQ-046): tổng hợp phiếu bán tạm − tồn hiện tại. Lập phiếu nhập tạm điền sẵn SL thiếu. */
export function ReorderPage() {
  const navigate = useNavigate();
  const canPurchase = useCan('purchase.write');
  const drawers = useDrawers();
  const [onlyShort, setOnlyShort] = useState(true);
  const q = useQuery({ queryKey: qk.report('draft-demand', { onlyShort }), queryFn: () => reportApi.draftDemand(onlyShort) });
  const items = q.data?.items ?? [];
  // Nhớ các mã người dùng BỎ chọn ⇒ dữ liệu tự làm mới (SSE) không làm mất lựa chọn; mã mới thiếu tự được chọn.
  const [unselected, setUnselected] = useState<Set<number>>(() => new Set());
  const shortIds = useMemo(() => items.filter((i) => i.shortage > 0).map((i) => i.product_id), [items]);
  const selected = shortIds.filter((id) => !unselected.has(id));

  const createPurchase = () => {
    const chosen = items.filter((i) => selected.includes(i.product_id) && i.shortage > 0);
    const drafts = [...new Set(chosen.flatMap((i) => i.drafts.map((d) => d.draft_no)))];
    navigate(paths.newDocument('purchase'), {
      state: {
        prefill: {
          lines: chosen.map((i) => ({ product_id: i.product_id, qty: i.shortage })),
          note: `Đặt hàng cho phiếu tạm ${drafts.join(', ')}`,
        },
      },
    });
  };

  const columns: ColumnsType<DraftDemandItem> = [
    { title: 'Mã hàng', dataIndex: 'product_code', width: 130, className: 'col-code' },
    { title: 'Tên hàng', dataIndex: 'product_name', ellipsis: true },
    { title: 'ĐVT', dataIndex: 'unit', width: 60 },
    { title: 'Khách cần', dataIndex: 'qty_in_drafts', width: 100, align: 'right', render: (n: number) => formatQty(n) },
    { title: 'Tồn 4 kho', dataIndex: 'total_stock', width: 100, align: 'right', render: (n: number) => formatQty(n) },
    {
      title: 'Thiếu, cần đặt',
      dataIndex: 'shortage',
      width: 120,
      align: 'right',
      render: (n: number) => (n > 0 ? <b className="neg">{formatQty(n)}</b> : <span className="muted">đủ hàng</span>),
    },
    { title: 'Phiếu tạm', key: 'n', width: 90, align: 'right', render: (_, r) => r.drafts.length },
  ];

  return (
    <div className="list-page">
      <PageHeader
        title="Hàng cần đặt"
        sub="Tổng hợp từ các phiếu bán tạm đang treo: số lượng khách đặt so với tồn hiện có. Bấm ▸ để xem phiếu nào, khách nào."
        actions={
          // bản mở rộng: chỉ ai lập được phiếu nhập mua mới thấy nút
          canPurchase && (
          <Tooltip title="Mở phiếu nhập mua mới, điền sẵn các mã đã chọn với số lượng thiếu; chọn nhà cung cấp rồi lưu">
            <Button type="primary" icon={<ShoppingOutlined />} disabled={!selected.some((id) => shortIds.includes(id))} onClick={createPurchase}>
              Lập phiếu nhập cho {selected.filter((id) => shortIds.includes(id)).length} mã thiếu
            </Button>
          </Tooltip>
          )
        }
      />
      <div className="toolbar">
        <Checkbox checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)}>
          Chỉ mã đang thiếu
        </Checkbox>
        <span className="muted">Phiếu tạm không giữ hàng — tồn là tồn thật hiện tại của cả 4 kho.</span>
      </div>
      <div className="table-wrap" style={{ overflow: 'auto' }}>
        <Table<DraftDemandItem>
          size="small"
          rowKey="product_id"
          loading={q.isLoading}
          dataSource={items}
          columns={columns}
          pagination={false}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => {
              const k = new Set(keys.map(Number));
              setUnselected(new Set(shortIds.filter((id) => !k.has(id))));
            },
            getCheckboxProps: (r) => ({ disabled: r.shortage <= 0 }),
          }}
          expandable={{
            expandedRowRender: (r) => (
              <table className="sub-table">
                <tbody>
                  {r.drafts.map((d) => (
                    <tr key={d.document_id} className="row-link" onClick={() => drawers.push({ kind: 'document', id: d.document_id, title: `Phiếu tạm ${d.draft_no}` })}>
                      <td className="link-text">{d.draft_no}</td>
                      <td>{formatDate(d.doc_date)}</td>
                      <td>{d.partner_name}</td>
                      <td className="num">
                        {formatQty(d.qty)} {r.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          }}
          locale={{ emptyText: onlyShort ? 'Không có mã nào thiếu hàng cho phiếu bán tạm.' : 'Không có phiếu bán tạm nào.' }}
        />
      </div>
    </div>
  );
}

interface Card {
  title: string;
  desc: string;
  to?: string;
  icon: React.ReactNode;
  soon?: boolean;
  /** Bản mở rộng: quyền cần có để thấy thẻ này (giống màn đích) */
  need?: Need;
}

/** Trang Báo cáo: thẻ lối vào bằng lời thường. */
export function ReportsHub() {
  const navigate = useNavigate();
  const access = useAccess();
  const groups: { title: string; cards: Card[] }[] = [
    {
      title: 'Kho',
      cards: [
        { title: 'Tồn kho', desc: 'Tồn từng mã theo 4 kho và tổng, đến một ngày bất kỳ. Xuất Excel toàn bộ mã.', to: paths.stock, icon: <DatabaseOutlined /> },
        { title: 'Thẻ kho (chi tiết NXT một mã)', desc: 'Từng lần nhập, xuất của một mã: mua của ai, bán cho ai, tồn sau mỗi lần.', to: paths.stockLedger, icon: <FileSearchOutlined /> },
        { title: 'Tổng hợp nhập – xuất – tồn', desc: 'Tồn đầu, nhập, xuất, tồn cuối từng mã trong một kỳ.', to: paths.stockNxt, icon: <AppstoreOutlined /> },
        { title: 'Hàng cần đặt', desc: 'Mã khách đã đặt trên phiếu bán tạm mà tồn không đủ.', to: paths.reorder, icon: <ShoppingOutlined /> },
      ],
    },
    {
      title: 'Bán hàng – Mua hàng',
      cards: [
        { title: 'Chi tiết bán hàng', desc: 'Từng dòng hàng đã bán: khách, mã, số lượng, giá, thành tiền.', to: paths.salesReport, icon: <ShoppingCartOutlined />, need: { all: ['report.view'] } },
        { title: 'Lịch sử bán theo mặt hàng', desc: 'Một mã đã bán cho ai, lúc nào, giá bao nhiêu.', to: paths.salesHistory, icon: <HistoryOutlined />, need: { all: ['report.view'] } },
        { title: 'Chi tiết mua hàng', desc: 'Từng dòng hàng đã nhập mua: nhà cung cấp, giá mua.', to: paths.purchasesReport, icon: <ShopOutlined />, need: { all: ['report.view', 'cost.view'] } },
      ],
    },
    {
      title: 'Công nợ – Quỹ',
      cards: [
        { title: 'Công nợ phải thu', desc: 'Khách hàng còn nợ: đầu kỳ, phát sinh, đã thu, cuối kỳ; bấm để xem sổ chi tiết từng khách.', to: paths.receivable, icon: <SolutionOutlined />, need: { all: ['debt.view'] } },
        { title: 'Công nợ phải trả', desc: 'Còn nợ nhà cung cấp: đầu kỳ, phát sinh, đã trả, cuối kỳ.', to: paths.payable, icon: <SolutionOutlined />, need: { all: ['debt.view', 'cost.view'] } },
        { title: 'Sổ quỹ / sổ ngân hàng', desc: 'Thu, chi, tồn quỹ tiền mặt và tài khoản ngân hàng theo ngày.', to: paths.cashBook, icon: <WalletOutlined />, need: { all: ['cash.view'] } },
        { title: 'Phiếu thu / phiếu chi', desc: 'Danh sách phiếu thu, phiếu chi (tiền mặt và ngân hàng), tổng tiền theo bộ lọc.', to: paths.receipts, icon: <WalletOutlined />, need: { any: ['cash.view', 'cash.write'] } },
      ],
    },
  ];
  return (
    <div className="hub">
      <PageHeader title="Báo cáo" sub="Mọi báo cáo bấm được vào từng dòng để xem chứng từ ngay tại chỗ, và xuất được Excel." />
      {groups
        .map((g) => ({ ...g, cards: g.cards.filter((c) => allowed(c.need, access, access.isAdmin)) }))
        .filter((g) => g.cards.length > 0)
        .map((g) => (
        <section key={g.title}>
          <h3>
            <BarChartOutlined /> {g.title}
          </h3>
          <div className="hub-cards">
            {g.cards.map((c) => (
              <button key={c.title} type="button" className={`hub-card${c.soon ? ' soon' : ''}`} disabled={c.soon} onClick={() => c.to && navigate(c.to)}>
                <span className="hub-icon">{c.icon}</span>
                <span>
                  <b>{c.title}</b>
                  <span className="hub-desc">{c.desc}</span>
                  {c.soon && <span className="hub-soon">Đang xây dựng</span>}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

