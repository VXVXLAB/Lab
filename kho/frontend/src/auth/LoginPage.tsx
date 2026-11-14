import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, type InputRef } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { errorMessage } from '../api/client';
import { useAuth } from './AuthContext';
import { storage } from '../lib/storage';

const LAST_USER_KEY = 'kho.lastUsername';

interface LoginValues {
  username: string;
  password: string;
}

export function LoginPage() {
  const { login, state } = useAuth();
  const [form] = Form.useForm<LoginValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const userRef = useRef<InputRef>(null);
  const passRef = useRef<InputRef>(null);
  const lastUser = storage.get(LAST_USER_KEY) ?? '';

  useEffect(() => {
    // Đã nhớ tên đăng nhập ⇒ con trỏ vào ô mật khẩu luôn.
    if (lastUser) passRef.current?.focus();
    else userRef.current?.focus();
  }, [lastUser]);

  const onFinish = async (v: LoginValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(v.username.trim(), v.password);
      storage.set(LAST_USER_KEY, v.username.trim());
    } catch (e) {
      setError(errorMessage(e));
      form.setFieldValue('password', '');
      passRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const reason = state.status === 'anonymous' ? state.reason : undefined;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <div>
            <h1>Quản lý Kho – Bán hàng</h1>
            <div className="login-sub">Kho · Bán hàng · Mua hàng · Công nợ · Thu chi</div>
          </div>
        </div>
        {reason === 'expired' && !error && (
          <Alert type="warning" showIcon message="Phiên làm việc đã hết. Vui lòng đăng nhập lại." style={{ marginBottom: 16 }} />
        )}
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Form<LoginValues>
          form={form}
          layout="vertical"
          initialValues={{ username: lastUser, password: '' }}
          onFinish={onFinish}
          requiredMark={false}
          size="large"
        >
          <Form.Item label="Tên đăng nhập" name="username" rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}>
            <Input
              ref={userRef}
              prefix={<UserOutlined />}
              autoComplete="username"
              onPressEnter={(e) => {
                e.preventDefault();
                passRef.current?.focus();
              }}
            />
          </Form.Item>
          <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
            <Input.Password ref={passRef} prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            Đăng nhập
          </Button>
        </Form>
        <div className="login-foot">Quên mật khẩu? Hãy nhờ người quản trị đặt lại.</div>
      </div>
    </div>
  );
}
