import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

export async function GET() {
  const report: any = {
    env: {
      url_configured: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      key_configured: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    }
  }

  try {
    // 1. Check Sessions Table
    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('id')
      .limit(1)
    
    report.sessions_table = {
      ok: !sessionsError,
      error: sessionsError,
      count: sessions?.length
    }

    // 2. Check Folders Table
    const { data: folders, error: foldersError } = await supabase
      .from('folders')
      .select('id')
      .limit(1)
      
    report.folders_table = {
      ok: !foldersError,
      error: foldersError,
      count: folders?.length
    }

    // 3. Check Auth (Generic)
    const { data: authData, error: authError } = await supabase.auth.getSession()
    report.auth_check = {
        ok: !authError,
        error: authError,
        session_exists: !!authData.session
    }

  } catch (e: any) {
    report.exception = e.message
  }

  return NextResponse.json(report, { status: 200 })
}
