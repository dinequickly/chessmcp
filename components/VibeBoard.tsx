'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useSupabaseUser } from '@/hooks/useSupabaseUser'
import { getOrCreateDefaultFolderId } from '@/lib/library'
import { Upload, X, Loader2 } from 'lucide-react'

interface MoodBoardItem {
  id: string
  image_url: string
  order_index: number
  added_by?: string | null
  folder_id?: string | null
}

interface VibeBoardProps {
  sessionId: string
}

export default function VibeBoard({ sessionId }: VibeBoardProps) {
  const { user } = useSupabaseUser()
  const [items, setItems] = useState<MoodBoardItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [defaultFolderId, setDefaultFolderId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function fetchItems() {
    if (!sessionId) return
    setFetching(true)
    const { data, error } = await supabase
      .from('mood_board_items')
      .select('*')
      .eq('session_id', sessionId)
      .order('order_index', { ascending: true })

    if (error) {
      console.error('Error fetching mood board items:', error)
    } else {
      setItems(data || [])
    }
    setFetching(false)
  }

  useEffect(() => {
    fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const folderId = await getOrCreateDefaultFolderId(user.id)
        setDefaultFolderId(folderId)
      } catch (e) {
        console.error('Failed to initialize default folder:', e)
      }
    })()
  }, [user?.id])

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files || event.target.files.length === 0) return
    if (!sessionId) return
    if (!user?.id || !defaultFolderId) {
      alert('Library not ready yet. Please try again in a moment.')
      return
    }

    setUploading(true)
    const file = event.target.files[0]
    const fileExt = file.name.split('.').pop()
    const fileName = `${user.id}/${defaultFolderId}/${Math.random()}.${fileExt}`
    const filePath = `${fileName}`

    // 1. Upload to Storage
    // We assume a bucket named 'uploads' exists.
    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file)

    if (uploadError) {
      console.error('Error uploading image:', uploadError)
      alert('Failed to upload image. Please ensure the "mood_board" bucket exists and is public.')
      setUploading(false)
      return
    }

    // 2. Get Public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath)

    // 3a. Save to Library (folder_items)
    const { error: libraryInsertError } = await supabase
      .from('folder_items')
      .insert({
        folder_id: defaultFolderId,
        image_url: publicUrl,
        title: file.name,
        added_by: user.id,
      })

    if (libraryInsertError) {
      console.error('Error saving to library:', libraryInsertError)
      alert('Failed to save image to library.')
      setUploading(false)
      return
    }

    // 3. Save to DB
    const newOrderIndex = items.length > 0 ? Math.max(...items.map(i => i.order_index)) + 1 : 0
    const { data: insertedData, error: insertError } = await supabase
      .from('mood_board_items')
      .insert({
        session_id: sessionId,
        image_url: publicUrl,
        order_index: newOrderIndex,
        is_curated: false, // Default
        added_by: user.id,
        folder_id: defaultFolderId,
        name: file.name,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error saving to DB:', insertError)
    } else if (insertedData) {
      setItems([...items, insertedData])
    }

    setUploading(false)
  }

  async function deleteItem(item: MoodBoardItem) {
    // Delete from the board
    const { error: boardDeleteError } = await supabase.from('mood_board_items').delete().eq('id', item.id)
    if (boardDeleteError) {
      console.error('Error deleting mood board item', boardDeleteError)
      return
    }

    setItems(items.filter((i) => i.id !== item.id))

    // Also delete the underlying library entry (if available)
    if (!user?.id) return
    const { error: libraryDeleteError } = await supabase
      .from('folder_items')
      .delete()
      .eq('image_url', item.image_url)
      .eq('added_by', user.id)

    if (libraryDeleteError) {
      console.error('Error deleting library item', libraryDeleteError)
    }
  }

  if (fetching) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-gray-800">Your Vibe Board <span className="text-sm font-normal text-gray-500">({items.length})</span></h2>
          {sessionId && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sessionId)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                } catch (e) {
                  console.error('Failed to copy sessionId:', e)
                }
              }}
              title={sessionId}
              className="hidden md:inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300"
            >
              <span className="font-mono">session</span>
              <span className="font-mono">{sessionId.slice(0, 8)}…</span>
              <span className="text-gray-400">{copied ? 'copied' : 'copy'}</span>
            </button>
          )}
          <button onClick={fetchItems} className="p-2 rounded-full hover:bg-gray-200" title="Refresh Board">
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
          </button>
        </div>
        <div className="relative">
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept="image/*"
            onChange={handleFileUpload}
            disabled={uploading}
          />
          <label
            htmlFor="file-upload"
            className={`flex items-center gap-2 px-4 py-2 bg-black text-white rounded-md cursor-pointer hover:bg-gray-800 transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Add Image'}
          </label>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-500">
          <p>No vibes yet. Upload an image to get started!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <div key={item.id} className="group relative aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
              <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm z-10 pointer-events-none">
                  #{item.order_index}
              </div>
              <Link href={`/editor/${item.id}`} className="block w-full h-full cursor-pointer">
                <img
                    src={`${item.image_url}?t=${new Date().getTime()}`} 
                    alt="Vibe"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </Link>
              <button 
                onClick={(e) => {
                    e.preventDefault() // Prevent navigation
                    e.stopPropagation()
                    deleteItem(item)
                }}
                className="absolute top-2 right-2 bg-white/80 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white text-red-500 z-10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
