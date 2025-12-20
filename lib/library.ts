'use client'

import { supabase } from '@/lib/supabaseClient'

export async function getOrCreateDefaultFolderId(userId: string) {
  const { data: existing, error: existingError } = await supabase
    .from('folders')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.id) return existing.id as string

  const { data: created, error: createError } = await supabase
    .from('folders')
    .insert({
      user_id: userId,
      name: 'All Uploads',
      description: 'Default library folder',
    })
    .select('id')
    .single()

  if (createError) throw createError
  return created.id as string
}
