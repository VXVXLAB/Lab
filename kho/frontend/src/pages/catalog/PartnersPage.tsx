import { useOpeningDebtVisibility } from '../../auth/guard';
import { lockedOpeningHint, useLockDate } from '../../lib/periodLock';
import { useMemo } from 'react';
import { Button, Checkbox, Col, Form, Input, Row, Switch, Tag, Tooltip } from 'antd';
import { SolutionOutlined } from '@ant-design/icons';
import { useDrawers } from '../reports/drawers';
import type { ColumnsType } from 'antd/es/table';
import { useQueryClient } from '@tanstack/react-query';
import { partnersApi } from '../../api/catalog';
import { qk } from '../../api/queryKeys';
import type { Partner, PartnerBody, PartnerType } from '../../api/types';
import { activeColumn, CatalogList } from '../../components/CatalogList';
import { EntityFormModal } from '../../components/EntityFormModal';
import { NumberInput } from '../../components/NumberInput';
import { formatMoney } from '../../lib/format';
import { codeRules, nameRules, normalizeCode } from './rules';
import { useEditor } from './useEditor';

const MODE = {
  customer: { title: 'Khách hàng', noun: 'khách hàng', openingField: 'opening_receivable', openingLabel: 'Nợ phải thu đầu kỳ' },
  supplier: { title: 'Nhà cung cấp', noun: 'nhà cung cấp', openingField: 'opening_payable', openingLabel: 'Nợ phải trả đầu kỳ' },
} as const;

function emptyPartner(type: PartnerType): PartnerBody {
  return {
    code: '',
    name: '',
    address: '',
    phone: '',
    tax_code: '',
    is_customer: type === 'customer',
    is_supplier: type === 'supplier',
    opening_receivable: 0,
    opening_payable: 0,
    active: true,
  };
}

/** Một màn cho cả Khách hàng và Nhà cung cấp (một đối tác có thể vừa là KH vừa là NCC). */
export function PartnersPage({ type }: { type: PartnerType }) {
  const drawers = useDrawers();
  const mode = MODE[type];
  const ed = useEditor<Partner>();
  const rec = ed.record;
  const extraParams = useMemo(() => ({ type }), [type]);
  const debtVis = useOpeningDebtVisibility();
  const openingVisible = type === 'customer' ? debtVis.receivable : debtVis.payable;

  const columns: ColumnsType<Partner> = [
    { title: 'Mã', dataIndex: 'code', width: 120, className: 'col-code', ellipsis: true },
    {
      title: type === 'customer' ? 'Tên khách hàng' : 'Tên nhà cung cấp',
      dataIndex: 'name',
      render: (name: string, r) => (
        <>
          <div className="cell-strong">{name}</div>
          {r.address && <div className="cell-sub">{r.address}</div>}
        </>
      ),
    },
    { title: 'Điện thoại', dataIndex: 'phone', width: 130 },
    { title: 'Mã số thuế', dataIndex: 'tax_code', width: 118 },
    ...(openingVisible
      ? [
          {
            title: mode.openingLabel,
            dataIndex: mode.openingField,
            width: 150,
            align: 'right' as const,
            render: (n: number | null) => (n ? formatMoney(n) : <span className="muted">–</span>),
          },
        ]
      : []),
    {
      title: 'Vai trò',
      key: 'roles',
      width: 104,
      render: (_, r) => (
        <>
          {r.is_customer && <Tag color="blue">KH</Tag>}
          {r.is_supplier && <Tag color="purple">NCC</Tag>}
        </>
      ),
    },
    activeColumn<Partner>(),
  ];

  return (
    <>
      <CatalogList<Partner>
        key={type}
        entity="partner"
        title={mode.title}
        noun={mode.noun}
        fetchList={partnersApi.list}
        extraParams={extraParams}
        searchPlaceholder="Tìm mã, tên, điện thoại, mã số thuế…"
        describe={(r) => `${r.code} – ${r.name}`}
        columns={columns}
        minWidth={1100}
        extraActionsWidth={32}
        extraActions={(r) => (
          <Tooltip title={type === 'customer' ? 'Xem công nợ phải thu' : 'Xem công nợ phải trả'}>
            <Button
              type="text"
              size="small"
              icon={<SolutionOutlined />}
              aria-label="Xem công nợ"
              onClick={() => drawers.push({ kind: 'debt', partner: { id: r.id, code: r.code, name: r.name }, side: type === 'customer' ? 'receivable' : 'payable' })}
            />
          </Tooltip>
        )}
        onCreate={ed.openCreate}
        onEdit={ed.openEdit}
        onDelete={(r) => partnersApi.remove(r.id)}
        onDeactivate={(r) => {
          const { id, ...body } = r;
          return partnersApi.update(id, { ...body, active: false });
        }}
      />
      <PartnerFormModal
        open={ed.open}
        type={type}
        record={rec}
        onClose={ed.close}
      />
    </>
  );
}

/** Hộp thoại thêm/sửa đối tác — dùng ở danh mục và "thêm nhanh" ngay trong phiếu. */
export function PartnerFormModal({
  open,
  type,
  record: rec,
  onClose,
  onSaved,
  initial,
}: {
  open: boolean;
  type: PartnerType;
  record: Partner | null;
  onClose: () => void;
  onSaved?: (p: Partner) => void;
  /** Giá trị gợi ý khi thêm mới (vd. tên vừa gõ ở ô tìm) */
  initial?: Partial<PartnerBody>;
}) {
  const mode = MODE[type];
  const [form] = Form.useForm<PartnerBody>();
  const qc = useQueryClient();
  const debtVis = useOpeningDebtVisibility();
  const lockDate = useLockDate();
  return (
      <EntityFormModal<PartnerBody>
        open={open}
        width={680}
        title={rec ? `Sửa ${mode.noun} ${rec.code}` : `Thêm ${mode.noun}`}
        form={form}
        initialValues={rec ? { ...rec } : { ...emptyPartner(type), ...initial }}
        onClose={onClose}
        fieldMap={{ is_supplier: 'is_customer' }}
        onSubmit={async (v) => {
          const body: PartnerBody = {
            code: normalizeCode(v.code),
            name: v.name.trim(),
            address: (v.address ?? '').trim(),
            phone: (v.phone ?? '').trim(),
            tax_code: (v.tax_code ?? '').trim(),
            is_customer: !!v.is_customer,
            is_supplier: !!v.is_supplier,
            // ô đang ẩn (bỏ chọn KH/NCC) vẫn giữ số cũ, không âm thầm xóa về 0
            // không được xem (bản mở rộng) ⇒ null: máy chủ giữ số cũ
            opening_receivable: debtVis.receivable ? ((form.getFieldValue('opening_receivable') as number | null) ?? 0) : null,
            opening_payable: debtVis.payable ? ((form.getFieldValue('opening_payable') as number | null) ?? 0) : null,
            active: v.active,
          };
          const saved = await (rec ? partnersApi.update(rec.id, body) : partnersApi.create(body));
          onSaved?.(saved);
        }}
        onSaved={() => void qc.invalidateQueries({ queryKey: qk.catalog('partner') })}
      >
        <Form.Item label="Mã" name="code" rules={codeRules} extra="Mã ngắn, dễ gõ — ví dụ VINHPHONG">
          <Input maxLength={50} style={{ width: 220 }} />
        </Form.Item>
        <Form.Item label="Tên" name="name" rules={nameRules}>
          <Input maxLength={300} />
        </Form.Item>
        <Form.Item label="Địa chỉ" name="address">
          <Input maxLength={500} />
        </Form.Item>
        <Form.Item label="Điện thoại" style={{ marginBottom: 0 }}>
          <Row gutter={12}>
            <Col span={11}>
              <Form.Item name="phone">
                <Input maxLength={50} />
              </Form.Item>
            </Col>
            <Col span={13}>
              <Form.Item name="tax_code" label="Mã số thuế" labelCol={{ flex: '90px' }}>
                <Input maxLength={20} />
              </Form.Item>
            </Col>
          </Row>
        </Form.Item>
        <Form.Item label="Là" required>
          <Row gutter={12}>
            <Col>
              <Form.Item
                name="is_customer"
                valuePropName="checked"
                noStyle
                rules={[
                  ({ getFieldValue }) => ({
                    validator: (_, v: boolean) =>
                      v || getFieldValue('is_supplier')
                        ? Promise.resolve()
                        : Promise.reject(new Error('Chọn ít nhất một: Khách hàng hoặc Nhà cung cấp')),
                  }),
                ]}
              >
                <Checkbox>Khách hàng</Checkbox>
              </Form.Item>
            </Col>
            <Col>
              <Form.Item name="is_supplier" valuePropName="checked" noStyle>
                <Checkbox onChange={() => void form.validateFields(['is_customer']).catch(() => undefined)}>Nhà cung cấp</Checkbox>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item shouldUpdate noStyle>
            {() => {
              const errs = form.getFieldError('is_customer');
              return errs.length ? <div className="ant-form-item-explain-error">{errs[0]}</div> : null;
            }}
          </Form.Item>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.is_customer !== b.is_customer || a.is_supplier !== b.is_supplier}>
          {({ getFieldValue }) => (
            <>
              {getFieldValue('is_customer') && debtVis.receivable && (
                <Form.Item label="Nợ phải thu đầu kỳ" name="opening_receivable" extra={lockDate ? lockedOpeningHint(lockDate) : 'Số khách còn nợ mình lúc bắt đầu dùng phần mềm'}>
                  <NumberInput style={{ width: 200 }} suffix="đ" disabled={!!lockDate} />
                </Form.Item>
              )}
              {getFieldValue('is_supplier') && debtVis.payable && (
                <Form.Item label="Nợ phải trả đầu kỳ" name="opening_payable" extra={lockDate ? lockedOpeningHint(lockDate) : 'Số mình còn nợ nhà cung cấp lúc bắt đầu dùng phần mềm'}>
                  <NumberInput style={{ width: 200 }} suffix="đ" disabled={!!lockDate} />
                </Form.Item>
              )}
            </>
          )}
        </Form.Item>
        <Form.Item label="Đang sử dụng" name="active" valuePropName="checked">
          <Switch checkedChildren="Có" unCheckedChildren="Không" />
        </Form.Item>
      </EntityFormModal>
  );
}
