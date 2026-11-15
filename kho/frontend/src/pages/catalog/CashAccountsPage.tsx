import { useCan } from '../../auth/AuthContext';
import { lockedOpeningHint, useLockDate } from '../../lib/periodLock';
import { Form, Input, Radio, Switch, Tag } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { cashAccountsApi } from '../../api/catalog';
import { qk } from '../../api/queryKeys';
import type { CashAccount, CashAccountBody } from '../../api/types';
import { activeColumn, CatalogList } from '../../components/CatalogList';
import { EntityFormModal } from '../../components/EntityFormModal';
import { NumberInput } from '../../components/NumberInput';
import { formatMoney } from '../../lib/format';
import { CASH_KIND_LABEL } from '../../lib/labels';
import { codeRules, nameRules, normalizeCode } from './rules';
import { useEditor } from './useEditor';

export function CashAccountsPage() {
  const ed = useEditor<CashAccount>();
  const [form] = Form.useForm<CashAccountBody>();
  const qc = useQueryClient();
  const rec = ed.record;
  const cashView = useCan('cash.view');
  const lockDate = useLockDate();

  return (
    <>
      <CatalogList<CashAccount>
        entity="cash_account"
        title="Tài khoản tiền"
        noun="tài khoản tiền"
        fetchList={cashAccountsApi.list}
        describe={(r) => `${r.code} – ${r.name}`}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 120, className: 'col-code' },
          { title: 'Tên tài khoản', dataIndex: 'name' },
          {
            title: 'Loại',
            dataIndex: 'kind',
            width: 120,
            render: (k: CashAccount['kind']) => <Tag color={k === 'cash' ? 'gold' : 'blue'}>{CASH_KIND_LABEL[k]}</Tag>,
          },
          ...(cashView
            ? [{ title: 'Số dư đầu kỳ', dataIndex: 'opening_balance', width: 160, align: 'right' as const, render: (n: number | null) => formatMoney(n) }]
            : []),
          activeColumn<CashAccount>(),
        ]}
        onCreate={ed.openCreate}
        onEdit={ed.openEdit}
        onDelete={(r) => cashAccountsApi.remove(r.id)}
        onDeactivate={(r) => {
          const { id, ...body } = r;
          return cashAccountsApi.update(id, { ...body, active: false });
        }}
      />
      <EntityFormModal<CashAccountBody>
        open={ed.open}
        title={rec ? `Sửa tài khoản tiền ${rec.code}` : 'Thêm tài khoản tiền'}
        form={form}
        initialValues={
          rec
            ? { code: rec.code, name: rec.name, kind: rec.kind, opening_balance: rec.opening_balance, active: rec.active }
            : { code: '', name: '', kind: 'cash', opening_balance: 0, active: true }
        }
        onClose={ed.close}
        onSubmit={(v) => {
          const body: CashAccountBody = {
            code: normalizeCode(v.code),
            name: v.name.trim(),
            kind: v.kind,
            // không được xem sổ quỹ (bản mở rộng) ⇒ null: máy chủ giữ số cũ
            opening_balance: cashView ? (v.opening_balance ?? 0) : null,
            active: v.active,
          };
          return rec ? cashAccountsApi.update(rec.id, body) : cashAccountsApi.create(body);
        }}
        onSaved={() => void qc.invalidateQueries({ queryKey: qk.catalog('cash_account') })}
      >
        <Form.Item label="Mã" name="code" rules={codeRules}>
          <Input maxLength={50} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item label="Tên tài khoản" name="name" rules={nameRules} extra="Ví dụ: Quỹ tiền mặt, Ngân hàng Vietcombank – CN Tân Bình">
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item label="Loại" name="kind" extra={rec ? 'Tài khoản đã có phiếu thu/chi thì không đổi được loại.' : undefined}>
          <Radio.Group
            options={[
              { label: 'Tiền mặt (phiếu thu PT / chi PC)', value: 'cash' },
              { label: 'Ngân hàng (báo có BC / báo nợ BN)', value: 'bank' },
            ]}
          />
        </Form.Item>
        {cashView && (
          <Form.Item label="Số dư đầu kỳ" name="opening_balance" extra={lockDate ? lockedOpeningHint(lockDate) : undefined}>
            <NumberInput style={{ width: 200 }} suffix="đ" disabled={!!lockDate} />
          </Form.Item>
        )}
        <Form.Item label="Đang sử dụng" name="active" valuePropName="checked">
          <Switch checkedChildren="Có" unCheckedChildren="Không" />
        </Form.Item>
      </EntityFormModal>
    </>
  );
}
