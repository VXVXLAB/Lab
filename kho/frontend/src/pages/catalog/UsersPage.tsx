import { App, Form, Input, Radio, Switch, Tag } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../api/catalog';
import { qk } from '../../api/queryKeys';
import type { User, UserBody } from '../../api/types';
import { useCurrentUser } from '../../auth/AuthContext';
import { CatalogList, StatusText } from '../../components/CatalogList';
import { matchText } from '../../lib/text';
import { EntityFormModal } from '../../components/EntityFormModal';
import { formatDateTime } from '../../lib/format';
import { ROLE_LABEL } from '../../lib/labels';
import { useEditor } from './useEditor';

export function UsersPage() {
  const ed = useEditor<User>();
  const [form] = Form.useForm<UserBody>();
  const qc = useQueryClient();
  const me = useCurrentUser();
  const { message } = App.useApp();
  const rec = ed.record;

  return (
    <>
      <CatalogList<User>
        entity="user"
        title="Người dùng"
        noun="người dùng"
        fetchList={() => usersApi.list()}
        clientFilter={(r, q) => matchText(q, `${r.username} ${r.full_name}`)}
        searchPlaceholder="Tìm tên đăng nhập, họ tên…"
        describe={(r) => `${r.username} – ${r.full_name}`}
        createLabel="Thêm người dùng"
        columns={[
          { title: 'Tên đăng nhập', dataIndex: 'username', width: 160, className: 'col-code' },
          {
            title: 'Họ tên',
            dataIndex: 'full_name',
            render: (n: string, r) => (
              <>
                {n} {r.id === me.id && <Tag>Bạn</Tag>}
              </>
            ),
          },
          {
            title: 'Vai trò',
            dataIndex: 'role',
            width: 120,
            render: (r: User['role']) => <Tag color={r === 'admin' ? 'red' : 'blue'}>{ROLE_LABEL[r]}</Tag>,
          },
          {
            title: 'Trạng thái',
            dataIndex: 'active',
            width: 120,
            render: (a: boolean) => <StatusText on={a} offText="Đã khóa" />,
          },
          { title: 'Ngày tạo', dataIndex: 'created_at', width: 150, render: (s: string) => formatDateTime(s) },
        ]}
        onCreate={ed.openCreate}
        onEdit={ed.openEdit}
      />
      <EntityFormModal<UserBody>
        open={ed.open}
        title={rec ? `Sửa người dùng ${rec.username}` : 'Thêm người dùng'}
        form={form}
        initialValues={
          rec
            ? { username: rec.username, full_name: rec.full_name, role: rec.role, active: rec.active, password: '' }
            : { username: '', full_name: '', role: 'ketoan', active: true, password: '' }
        }
        onClose={ed.close}
        onSubmit={async (v) => {
          const body: UserBody = {
            username: v.username.trim(),
            full_name: v.full_name.trim(),
            role: v.role,
            active: v.active,
            password: v.password ?? '',
          };
          if (rec) {
            await usersApi.update(rec.id, body);
            if (body.password || (rec.active && !body.active)) {
              message.info(`${body.full_name} sẽ phải đăng nhập lại trên mọi máy.`, 3);
            }
          } else {
            await usersApi.create(body);
          }
        }}
        onSaved={() => void qc.invalidateQueries({ queryKey: qk.catalog('user') })}
      >
        <Form.Item label="Tên đăng nhập" name="username" rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên đăng nhập' }]}>
          <Input maxLength={50} style={{ width: 220 }} autoComplete="off" />
        </Form.Item>
        <Form.Item
          label="Họ tên"
          name="full_name"
          rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập họ tên' }]}
          extra="Nên ghi kèm máy đang dùng, ví dụ: Nguyễn Thị Lan (Máy 1) — tên này hiện trên phiếu và khi máy khác sửa phiếu."
        >
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item
          label="Mật khẩu"
          name="password"
          rules={[
            ...(rec ? [] : [{ required: true, message: 'Vui lòng nhập mật khẩu' }]),
            { min: 6, message: 'Mật khẩu ít nhất 6 ký tự' },
          ]}
          extra={rec ? 'Để trống nếu không đổi mật khẩu.' : 'Ít nhất 6 ký tự.'}
        >
          <Input.Password style={{ width: 220 }} autoComplete="new-password" />
        </Form.Item>
        <Form.Item label="Vai trò" name="role">
          <Radio.Group
            options={[
              { label: 'Kế toán', value: 'ketoan' },
              { label: 'Quản trị (quản lý người dùng)', value: 'admin' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Được đăng nhập" name="active" valuePropName="checked" extra="Tắt để khóa tài khoản (người nghỉ việc). Không xóa được người dùng.">
          <Switch checkedChildren="Có" unCheckedChildren="Khóa" />
        </Form.Item>
      </EntityFormModal>
    </>
  );
}
