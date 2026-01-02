'use client';

import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import Link from "next/link";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppsSDKUIProvider linkComponent={Link}>
      {children}
    </AppsSDKUIProvider>
  );
}
