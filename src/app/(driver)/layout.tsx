import type { Metadata, Viewport } from "next";

/**
 * El panel del repartidor vive en su propio grupo de rutas, FUERA de `(app)`.
 *
 * No hereda la barra lateral, ni el tema del negocio, ni la comprobación de
 * sesión: el repartidor no tiene sesión y no necesita ver el CRM. Su pantalla
 * pesa lo que pesa un formulario, que es lo que quiere quien la abre con datos
 * móviles en una esquina.
 */

export const metadata: Metadata = {
  title: "Mis entregas",
  /**
   * Fuera de los buscadores. Los enlaces llevan un token y aunque no se puedan
   * adivinar, un panel de reparto indexado es un panel de reparto que alguien
   * encuentra sin buscarlo.
   */
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sin zoom bloqueado: quien necesite agrandar una dirección tiene que poder.
  maximumScale: 5,
};

export default function DriverLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-dvh bg-slate-50 text-slate-900">{children}</div>;
}
