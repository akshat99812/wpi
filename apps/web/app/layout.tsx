import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import AuthProvider from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "Wind Power India",
  description: "Geospatial intelligence portal and live data pipeline for India's wind energy market.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
