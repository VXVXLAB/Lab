import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, Result, Spin } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { ApiError } from './api/client';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { AppLayout } from './layout/AppLayout';
import { EventsProvider } from './lib/events';
import { allScreens } from './routes';
import { theme } from './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        // Lỗi nghiệp vụ (4xx) không thử lại; mất mạng thử lại 2 lần.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
    },
    mutations: { retry: false },
  },
});

function Forbidden() {
  return <Result status="403" title="Không có quyền" subTitle="Chỉ người quản trị mới mở được màn này." />;
}

function NotFound() {
  return <Result status="404" title="Không có màn hình này" subTitle="Hãy chọn chức năng ở menu bên trái." />;
}

function AuthedApp() {
  const { state, user } = useAuth();
  if (state.status === 'loading') {
    return (
      <div className="boot">
        <Spin size="large" />
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return (
    <EventsProvider key={user.id}>
      <Routes>
        <Route element={<AppLayout />}>
          {allScreens().map((s) => (
            <Route
              key={s.path}
              path={s.path}
              element={s.adminOnly && user.role !== 'admin' ? <Forbidden /> : s.element}
            />
          ))}
          <Route path="/dang-nhap" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </EventsProvider>
  );
}

export default function App() {
  return (
    <ConfigProvider locale={viVN} theme={theme}>
      <AntApp message={{ maxCount: 3, top: 56 }}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
              <AuthedApp />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
