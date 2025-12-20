'use client'

import { useSessionContext } from '@/components/SessionProvider'

export function useSession() {
  return useSessionContext()
}
