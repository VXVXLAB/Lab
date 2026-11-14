import { App, Form, Input } from 'antd';
import { authApi } from '../api/reports';
import { EntityFormModal } from '../components/EntityFormModal';

interface V {
  old_password: string;
  new_password: string;
  confirm: string;
}

/** Đổi mật khẩu của chính mình (mọi người dùng). Máy khác đang đăng nhập bằng tài khoản này sẽ phải đăng nhập lại. */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<V>();
  const { message } = App.useApp();
  return (
    <EntityFormModal<V>
      open={open}
      title="Đổi mật khẩu"
      form={form}
      width={480}
      initialValues={{ old_password: '', new_password: '', confirm: '' }}
      successMessage="Đã đổi mật khẩu"
      onClose={onClose}
      onSubmit={async (v) => {
        await authApi.changePassword(v.old_password, v.new_password);
        message.info('Các máy khác đang dùng tài khoản này sẽ phải đăng nhập lại bằng mật khẩu mới.', 3);
      }}
    >
      <Form.Item label="Mật khẩu hiện tại" name="old_password" rules={[{ required: true, message: 'Nhập mật khẩu đang dùng' }]}>
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Form.Item label="Mật khẩu mới" name="new_password" rules={[{ required: true, message: 'Nhập mật khẩu mới' }, { min: 6, message: 'Ít nhất 6 ký tự' }]}>
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        label="Gõ lại mật khẩu mới"
        name="confirm"
        dependencies={['new_password']}
        rules={[
          { required: true, message: 'Gõ lại mật khẩu mới' },
          ({ getFieldValue }) => ({
            validator: (_, v: string) => (!v || v === getFieldValue('new_password') ? Promise.resolve() : Promise.reject(new Error('Hai lần gõ không giống nhau'))),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </EntityFormModal>
  );
}
