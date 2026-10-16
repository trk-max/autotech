import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoTech — Données techniques et diagnostic',
  description: "Identification véhicule, diagnostic guidé multi-codes, schémas électriques interactifs, temps barémés et entretien.",
};
export const viewport: Viewport = { themeColor: '#151b23', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
