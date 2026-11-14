import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { App, Button, Layout, Menu, Tooltip, type MenuProps } from 'antd';
import { LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useAuth, useCurrentUser } from '../auth/AuthContext';
import { useLiveStatus } from '../lib/events';
import { ROLE_LABEL } from '../lib/labels';
import { storage } from '../lib/storage';
import { allScreens, menu } from '../routes';

const { Sider, Header, Content } = Layout;
const COLLAPSE_KEY = 'kho.menuCollapsed';

function LiveIndicator() {
  const status = useLiveStatus();
  const text =
    status === 'open'
      ? 'Đang kết nối máy chủ — phiếu từ máy khác hiện ngay'
      : status === 'connecting'
        ? 'Đang kết nối máy chủ…'
        : 'Mất kết nối máy chủ — đang thử nối lại. Số liệu có thể chưa mới nhất.';
  return (
    <Tooltip title={text}>
      <span className={`live live-${status}`} aria-label={text}>
        <span className="dot" />
        <span className="live-text">{status === 'open' ? 'Trực tuyến' : status === 'connecting' ? 'Đang kết nối' : 'Mất kết nối'}</span>
      </span>
    </Tooltip>
  );
}

export function AppLayout() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const { modal } = App.useApp();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => storage.get(COLLAPSE_KEY) === '1');
  const isAdmin = user.role === 'admin';

  const screens = useMemo(() => allScreens(), []);
  const current = useMemo(() => {
    const p = location.pathname;
    return screens.find((s) => s.path === p) ?? screens.find((s) => s.path !== '/' && s.path.includes(':') && p.startsWith(s.path.split(':')[0] ?? '#'));
  }, [location.pathname, screens]);

  const [openKeys, setOpenKeys] = useState<string[]>(() => (current?.groupKey ? [current.groupKey] : []));
  useEffect(() => {
    if (current?.groupKey && !collapsed) setOpenKeys((k) => (k.includes(current.groupKey!) ? k : [...k, current.groupKey!]));
  }, [current?.groupKey, collapsed]);

  useEffect(() => {
    document.title = current ? `${current.label} – Quản lý Kho` : 'Quản lý Kho – Bán hàng';
  }, [current]);

  const items: MenuProps['items'] = menu
    .filter((g) => !g.adminOnly || isAdmin)
    .map((g) =>
      g.screen
        ? { key: g.screen.path, icon: g.icon, label: <Link to={g.screen.path}>{g.label}</Link> }
        : {
            key: g.key,
            icon: g.icon,
            label: g.label,
            children: (g.items ?? [])
              .filter((it) => !it.adminOnly || isAdmin)
              .map((it) => ({ key: it.path, label: <Link to={it.path}>{it.label}</Link> })),
          },
    );

  const toggle = () => {
    setCollapsed((c) => {
      storage.set(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  const askLogout = () =>
    modal.confirm({
      title: 'Đăng xuất?',
      content: 'Phiếu đang mở chưa lưu sẽ mất.',
      okText: 'Đăng xuất',
      cancelText: 'Ở lại',
      onOk: () => logout(),
    });

  return (
    <Layout className="app">
      <Sider
        width={224}
        collapsedWidth={56}
        collapsed={collapsed}
        breakpoint="lg"
        onBreakpoint={(broken) => broken && setCollapsed(true)}
        trigger={null}
        className="app-sider"
        theme="light"
      >
        <Link to="/" className="brand" title="Tổng quan">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          {!collapsed && <span>Quản lý Kho</span>}
        </Link>
        <Menu
          mode="inline"
          inlineIndent={16}
          items={items}
          selectedKeys={current ? [current.path] : []}
          openKeys={collapsed ? undefined : openKeys}
          onOpenChange={(k) => setOpenKeys(k)}
          className="app-menu"
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggle}
            aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
          />
          <div className="crumb">
            {current?.groupLabel && <span className="crumb-group">{current.groupLabel} ›</span>}
            <span className="crumb-title">{current?.label ?? ''}</span>
          </div>
          <div className="header-right">
            <LiveIndicator />
            <span className="user">
              <b>{user.full_name}</b>
              {ROLE_LABEL[user.role] !== user.full_name && <span className="role">{ROLE_LABEL[user.role]}</span>}
            </span>
            <Button icon={<LogoutOutlined />} onClick={askLogout}>
              Đăng xuất
            </Button>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
