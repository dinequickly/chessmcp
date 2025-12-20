'use client'

import { useSession } from '@/hooks/useSession'
import VibeBoard from '@/components/VibeBoard'
import ChatPanel from '@/components/ChatPanel'
import { Loader2 } from 'lucide-react'

export default function Home() {

  const { sessionId, loading, error } = useSession()

  const isConfigured = process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')

  return (

    <main className="min-h-screen bg-gray-50 px-6 py-8 lg:px-10 font-[family-name:var(--font-geist-sans)]">

      <div className="max-w-7xl mx-auto space-y-8">

                <header className="flex flex-col gap-2 border-b border-gray-200 pb-6">

                  <div className="flex items-center justify-between">

                    <h1 className="text-4xl font-bold tracking-tight text-gray-900">Image Platform</h1>

                    <a href="/library" className="text-sm font-medium text-gray-600 hover:text-black hover:underline">

                      Go to Library →

                    </a>

                  </div>

                  <p className="text-gray-500">Curate your visual identity.</p>

                </header>



        {!isConfigured && (

           <div className="rounded-lg bg-yellow-50 p-4 text-yellow-800 border border-yellow-200">

            <strong>Configuration Warning:</strong> It looks like you haven&apos;t updated your <code>.env.local</code> file with your Supabase credentials, or you need to restart your dev server.

          </div>

        )}



        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8 items-start">
          <aside className="order-2 lg:order-1 lg:sticky lg:top-8">
            <ChatPanel />
          </aside>
          <section className="order-1 lg:order-2">
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Initializing session...</span>
              </div>
            ) : sessionId ? (
              <>
                {error && (
                  <div className="rounded-lg bg-red-50 p-4 text-red-600 border border-red-200 mb-6">
                    <p className="font-semibold">Session warning:</p>
                    <pre className="mt-2 text-xs bg-white p-2 rounded border border-red-100 overflow-auto">{error}</pre>
                  </div>
                )}
                <VibeBoard sessionId={sessionId} />
              </>
            ) : error ? (
              <div className="rounded-lg bg-red-50 p-4 text-red-600 border border-red-200">
                <p className="font-semibold">Failed to initialize session:</p>
                <pre className="mt-2 text-xs bg-white p-2 rounded border border-red-100 overflow-auto">{error}</pre>
                <p className="mt-2 text-sm">Please check your database connection and RLS policies.</p>
              </div>
            ) : (
              <div className="rounded-lg bg-red-50 p-4 text-red-600">Unknown error: No session ID.</div>
            )}
          </section>
        </div>

      </div>
    </main>
  )
}
