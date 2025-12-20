'use client'

import React, { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

interface FileUploaderProps {
  sessionId?: string
  folderId?: string
  userId?: string
  onUploadComplete: () => void
}

export default function FileUploader({ sessionId, folderId, userId, onUploadComplete }: FileUploaderProps) {
  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    if (!sessionId && (!folderId || !userId)) return // Must have either session OR user+folder
    
    setUploading(true)

    try {
      const uploadPromises = acceptedFiles.map(async (file) => {
        const fileExt = file.name.split('.').pop()
        const pathPrefix = userId ? `${userId}/${folderId}` : sessionId
        const fileName = `${pathPrefix}/${Math.random()}.${fileExt}`
        
        // 1. Upload to Storage
        const { error: uploadError } = await supabase.storage
          .from('uploads')
          .upload(fileName, file)

        if (uploadError) throw uploadError

        const { data: { publicUrl } } = supabase.storage
          .from('uploads')
          .getPublicUrl(fileName)

        // 2. Add to DB
        if (userId && folderId) {
            // Authenticated: Add to Folder Items
            const { error: insertError } = await supabase
              .from('folder_items')
              .insert({
                folder_id: folderId,
                image_url: publicUrl,
                title: file.name,
                added_by: userId,
              })
            if (insertError) throw insertError
        } else if (sessionId) {
            // Anonymous: Add to Mood Board Items
            const { error: insertError } = await supabase
              .from('mood_board_items')
              .insert({
                session_id: sessionId,
                image_url: publicUrl,
                name: file.name,
                order_index: 0, 
                is_curated: false
              })
            if (insertError) throw insertError
        }
      })

      await Promise.all(uploadPromises)
      onUploadComplete()
      
    } catch (error) {
      console.error('Upload failed:', error)
      alert('Some files failed to upload.')
    } finally {
      setUploading(false)
    }
  }, [sessionId, folderId, userId, onUploadComplete])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 'image/*': [] }
  })

  return (
    <div 
      {...getRootProps()} 
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
        ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}
        ${uploading ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-2 text-gray-500">
        {uploading ? (
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        ) : (
          <Upload className={`w-8 h-8 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} />
        )}
        {isDragActive ? (
          <p className="font-medium text-blue-500">Drop the images here...</p>
        ) : (
          <div>
            <p className="font-medium text-gray-700">Drag & drop images here, or click to select</p>
            <p className="text-sm">Supports PNG, JPG, GIF</p>
          </div>
        )}
      </div>
    </div>
  )
}