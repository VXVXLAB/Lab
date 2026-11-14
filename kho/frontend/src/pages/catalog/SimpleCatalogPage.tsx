import { Form, Input, Switch } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import type { CatalogResource } from '../../api/catalog';
import { productGroupsApi, warehousesApi } from '../../api/catalog';
import { qk } from '../../api/queryKeys';
import type { CatalogEntity } from '../../api/types';
import { activeColumn, CatalogList } from '../../components/CatalogList';
import { EntityFormModal } from '../../components/EntityFormModal';
import { codeRules, nameRules, normalizeCode } from './rules';
import { useEditor } from './useEditor';

interface Simple {
  id: number;
  code: string;
  name: string;
  active: boolean;
}
type SimpleBody = Omit<Simple, 'id'>;

interface Config {
  entity: CatalogEntity;
  title: string;
  noun: string;
  nameLabel: string;
  resource: CatalogResource<Simple, SimpleBody>;
}

function SimpleCatalogPage({ entity, title, noun, nameLabel, resource }: Config) {
  const ed = useEditor<Simple>();
  const [form] = Form.useForm<SimpleBody>();
  const qc = useQueryClient();
  const rec = ed.record;

  return (
    <>
      <CatalogList<Simple>
        entity={entity}
        title={title}
        noun={noun}
        fetchList={resource.list}
        describe={(r) => `${r.code} – ${r.name}`}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 140, className: 'col-code' },
          { title: nameLabel, dataIndex: 'name' },
          activeColumn<Simple>(),
        ]}
        onCreate={ed.openCreate}
        onEdit={ed.openEdit}
        onDelete={(r) => resource.remove(r.id)}
        onDeactivate={(r) => resource.update(r.id, { code: r.code, name: r.name, active: false })}
      />
      <EntityFormModal<SimpleBody>
        open={ed.open}
        title={rec ? `Sửa ${noun} ${rec.code}` : `Thêm ${noun}`}
        form={form}
        initialValues={rec ? { code: rec.code, name: rec.name, active: rec.active } : { code: '', name: '', active: true }}
        onClose={ed.close}
        onSubmit={(v) => {
          const body: SimpleBody = { code: normalizeCode(v.code), name: v.name.trim(), active: v.active };
          return rec ? resource.update(rec.id, body) : resource.create(body);
        }}
        onSaved={() => void qc.invalidateQueries({ queryKey: qk.catalog(entity) })}
      >
        <Form.Item label="Mã" name="code" rules={codeRules}>
          <Input maxLength={50} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item label={nameLabel} name="name" rules={nameRules}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item label="Đang sử dụng" name="active" valuePropName="checked">
          <Switch checkedChildren="Có" unCheckedChildren="Không" />
        </Form.Item>
      </EntityFormModal>
    </>
  );
}

export function WarehousesPage() {
  return <SimpleCatalogPage entity="warehouse" title="Kho" noun="kho" nameLabel="Tên kho" resource={warehousesApi} />;
}

export function ProductGroupsPage() {
  return (
    <SimpleCatalogPage
      entity="product_group"
      title="Nhóm hàng (nhóm VTHH)"
      noun="nhóm hàng"
      nameLabel="Tên nhóm"
      resource={productGroupsApi}
    />
  );
}
