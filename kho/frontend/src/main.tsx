import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/format'; // nạp dayjs + locale tiếng Việt trước khi vẽ
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
