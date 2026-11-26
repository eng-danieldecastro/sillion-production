import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Central de Produção - Sillion",
  description: "Gestão de acessos e respostas do aplicativo Central de Produção",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
