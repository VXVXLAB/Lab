import { useEffect, useMemo, useState } from 'react';
import { App, Alert, Button, Checkbox, Skeleton, Space, Tooltip } from 'antd';
import { LockOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import { rolePermissionsApi } from '../../api/extended';
import type { Permission, Role } from '../../api/types';
import { ALL_PERMISSIONS, useAuth } from '../../auth/AuthContext';
import { PERMISSION_HINT, PERMISSION_LABEL } from '../../auth/guard';
import { PageHeader } from '../../components/PageHeader';
import { Kbd } from '../../components/Kbd';
import { useHotkeys } from '../../lib/keyboard';
import { ROLE_LABEL } from '../../lib/labels';

/** Ma trận mặc định (SPEC_MO_RONG.md C1) — nút "Về mặc định". */
const DEFAULTS: Record<Exclude<Role, 'admin'>, Permission[]> = {
  ketoan: [...ALL_PERMISSIONS],
  banhang: ['sale.write', 'cash.write', 'debt.view', 'report.view'],
  muahang: ['purchase.write', 'stock.write', 'cash.write', 'cost.view', 'debt.view', 'report.view'],
  thukho: ['stock.write'],
};
const EDITABLE: Exclude<Role, 'admin'>[] = ['ketoan', 'banhang', 'muahang', 'thukho'];
const key = ['role-permissions'] as const;

/** Hệ thống › Phân quyền: vai trò × quyền (chỉ quản trị; tính năng "Phân quyền" bật). */
export function PermissionsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const q = useQuery({ queryKey: key, queryFn: rolePermissionsApi.get });
  const [m, setM] = useState<Record<string, Set<Permission>>>({});
  const [saving, setSaving] = useState(false);

  const load = (matrix: Partial<Record<Role, Permission[]>>) =>
    setM(Object.fromEntries(EDITABLE.map((r) => [r, new Set(matrix[r] ?? [])])));
  useEffect(() => {
    if (q.data) load(q.data.matrix);
  }, [q.data]);

  const perms: Permission[] = q.data?.permissions.map((p) => p.key) ?? ALL_PERMISSIONS;
  const roles: Role[] = ['admin', ...EDITABLE];
  const roleName = (r: Role) => q.data?.roles.find((x) => x.key === r)?.name ?? ROLE_LABEL[r];
  const dirty = useMemo(
    () => !!q.data && EDITABLE.some((r) => [...(m[r] ?? [])].sort().join() !== [...(q.data.matrix[r] ?? [])].sort().join()),
    [m, q.data],
  );

  const toggle = (r: Role, p: Permission, on: boolean) =>
    setM((x) => {
      const s = new Set(x[r]);
      if (on) s.add(p);
      else s.delete(p);
      return { ...x, [r]: s };
    });

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const r = await rolePermissionsApi.set(Object.fromEntries(EDITABLE.map((role) => [role, perms.filter((p) => m[role]?.has(p))])));
      qc.setQueryData(key, r);
      await refresh();
      message.success('Đã lưu phân quyền — các máy khác áp dụng ngay', 2);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  useHotkeys({ 'Ctrl+s': () => void save() });

  return (
    <div className="perm-page">
      <PageHeader
        title="Phân quyền"
        sub="Mỗi cột là một vai trò, mỗi dòng là một việc. Đánh dấu để cho phép. Quản trị luôn làm được mọi việc. Xem tồn kho, thẻ kho, danh mục và chứng từ: vai trò nào cũng được."
        actions={
          <Space>
            <Button icon={<UndoOutlined />} onClick={() => setM(Object.fromEntries(EDITABLE.map((r) => [r, new Set(DEFAULTS[r])])))}>
              Về mặc định
            </Button>
            <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={() => void save()}>
              Lưu <Kbd>Ctrl+S</Kbd>
            </Button>
          </Space>
        }
      />
      {q.isLoading ? (
        <Skeleton active />
      ) : q.isError ? (
        <Alert type="error" showIcon message={errorMessage(q.error)} />
      ) : (
        <div className="perm-wrap">
          <table className="perm-table">
            <thead>
              <tr>
                <th>Việc được làm</th>
                {roles.map((r) => (
                  <th key={r} className="perm-col">
                    {roleName(r)}
                    {r === 'admin' && <LockOutlined className="muted" style={{ marginLeft: 4 }} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perms.map((p) => (
                <tr key={p}>
                  <td>
                    <div className="perm-name">{q.data?.permissions.find((x) => x.key === p)?.name ?? PERMISSION_LABEL[p]}</div>
                    <div className="perm-hint">{PERMISSION_HINT[p]}</div>
                  </td>
                  {roles.map((r) => (
                    <td key={r} className="perm-col">
                      {r === 'admin' ? (
                        <Tooltip title="Quản trị luôn đủ quyền">
                          <Checkbox checked disabled aria-label={`${roleName(r)}: ${PERMISSION_LABEL[p]}`} />
                        </Tooltip>
                      ) : (
                        <Checkbox
                          checked={!!m[r]?.has(p)}
                          onChange={(e) => toggle(r, p, e.target.checked)}
                          aria-label={`${roleName(r)}: ${PERMISSION_LABEL[p]}`}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {dirty && <Alert style={{ marginTop: 10 }} type="warning" showIcon message="Có thay đổi chưa lưu — bấm Lưu (Ctrl+S)." />}
        </div>
      )}
    </div>
  );
}
