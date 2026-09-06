import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Dueltective · 双人推理对决',
  icons: { icon: '/favicon.svg' },
  description: '把你想知道的摆上牌桌……或者保持沉默。',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
