import { useEffect, useRef, useState, type ReactNode } from 'react';
import { App, Button, Form, Modal, Space, type FormInstance } from 'antd';
import { ApiError, errorMessage } from '../api/client';
import { enterToNext, focusFirstField, useHotkeys } from '../lib/keyboard';
import { Kbd } from './Kbd';

export interface EntityFormModalProps<V> {
  open: boolean;
  title: ReactNode;
  form: FormInstance<V>;
  initialValues: Partial<V>;
  /** Gọi máy chủ; ném ApiError để hiện lỗi. */
  onSubmit: (values: V) => Promise<unknown>;
  onClose: () => void;
  /** Gọi sau khi lưu thành công (đã tự hiện "Đã lưu"). */
  onSaved?: () => void;
  successMessage?: string;
  width?: number;
  children: ReactNode;
  /** Vùng bên phải (vd. tồn kho của mặt hàng). */
  aside?: ReactNode;
  /** Ánh xạ tên trường máy chủ (`details.field`) ⇒ tên trường form, nếu khác. */
  fieldMap?: Record<string, string>;
}

/**
 * Hộp thoại thêm/sửa dùng chung cho danh mục.
 * - Mở ra con trỏ nằm ở ô đầu tiên; Enter sang ô kế tiếp, Enter ở ô cuối ⇒ Lưu; Ctrl+S lưu; Esc đóng.
 * - Lỗi kiểm tra của máy chủ có `details.field` ⇒ hiện ngay dưới ô đó và đưa con trỏ về ô đó.
 */
export function EntityFormModal<V extends object>({
  open,
  title,
  form,
  initialValues,
  onSubmit,
  onClose,
  onSaved,
  successMessage = 'Đã lưu',
  width = 560,
  children,
  aside,
  fieldMap,
}: EntityFormModalProps<V>) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const submit = async () => {
    if (saving) return;
    setFormError(null);
    let values: V;
    try {
      values = await form.validateFields();
    } catch {
      focusFirstError();
      return;
    }
    setSaving(true);
    try {
      await onSubmit(values);
      message.success(successMessage, 1.5);
      onSaved?.();
      onClose();
    } catch (e) {
      const field = e instanceof ApiError ? e.field : undefined;
      const name = field ? (fieldMap?.[field] ?? field) : undefined;
      const registered = name !== undefined && form.getFieldsError().some((f) => f.name[0] === name);
      if (name && registered) {
        form.setFields([{ name: name as never, errors: [errorMessage(e)] }]);
        window.setTimeout(() => {
          const el = bodyRef.current?.querySelector<HTMLElement>(`#${CSS.escape(name)}`);
          el?.focus();
          if (el instanceof HTMLInputElement) el.select();
        }, 0);
      } else {
        setFormError(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const focusFirstError = () => {
    window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>('.ant-form-item-has-error input, .ant-form-item-has-error [role=combobox]');
      el?.focus();
    }, 0);
  };

  // Con trỏ vào ô đầu ngay khi hộp thoại hiện (không chờ hết hiệu ứng) để gõ liền không mất phím.
  useEffect(() => {
    if (!open) return undefined;
    setFormError(null);
    // Form dùng chung một instance qua nhiều lần mở ⇒ nạp lại giá trị của lần mở này
    // (prop initialValues của antd chỉ có tác dụng lần đầu).
    form.resetFields();
    form.setFieldsValue(initialValues as Parameters<typeof form.setFieldsValue>[0]);
    const t = window.setTimeout(() => focusFirstField(bodyRef.current), 30);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onEnter = enterToNext(() => void submit());

  useHotkeys({ 'Ctrl+s': () => void submit() }, { enabled: open, inOverlay: true });

  return (
    <Modal
      open={open}
      title={title}
      width={aside ? width + 320 : width}
      onCancel={onClose}
      maskClosable={false}
      destroyOnHidden
      afterOpenChange={(o) => {
        // Dự phòng: nếu trình duyệt chưa đặt được con trỏ vào ô nào thì đặt lại.
        if (o && !bodyRef.current?.contains(document.activeElement)) focusFirstField(bodyRef.current);
      }}
      footer={
        <div className="modal-footer">
          <span className="hint">
            <Kbd>Enter</Kbd> ô kế tiếp · <Kbd>Ctrl+S</Kbd> lưu · <Kbd>Esc</Kbd> đóng
          </span>
          <Space>
            <Button onClick={onClose}>Đóng</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              Lưu
            </Button>
          </Space>
        </div>
      }
    >
      <div className={aside ? 'form-with-aside' : undefined}>
        <div
          ref={bodyRef}
          onKeyDownCapture={(e) => {
            // Esc trong ô chọn (Select/AutoComplete): lần 1 đóng danh sách, lần 2 đóng hộp thoại
            // (antd tự nuốt Esc ở ô chọn nên phải xử lý ở đây).
            const t = e.target as HTMLElement;
            if (e.key === 'Escape' && t.getAttribute('role') === 'combobox') {
              e.preventDefault();
              e.stopPropagation();
              if (t.getAttribute('aria-expanded') === 'true') {
                // Rời ô một nhịp để antd đóng danh sách, rồi đặt con trỏ lại.
                t.blur();
                window.setTimeout(() => t.focus(), 60);
              } else {
                onClose();
              }
              return;
            }
            onEnter(e);
          }}
          className="form-main"
        >
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <Form<V>
            form={form}
            layout="horizontal"
            labelCol={{ flex: '150px' }}
            labelAlign="left"
            labelWrap
            colon={false}
            initialValues={initialValues}
            requiredMark={(label, { required }) => (
              <>
                {label}
                {required && <span className="req">*</span>}
              </>
            )}
            onValuesChange={() => formError && setFormError(null)}
          >
            {children}
          </Form>
        </div>
        {aside && <div className="form-aside">{aside}</div>}
      </div>
    </Modal>
  );
}
