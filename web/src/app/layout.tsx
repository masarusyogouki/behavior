import type { Metadata } from 'next'
import '../index.css'
import '../App.css'

export const metadata: Metadata = {
  title: 'Browser',
  description: 'Remote browser session',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
