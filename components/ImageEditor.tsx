'use client'

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useSession } from '@/hooks/useSession'
import { useSupabaseUser } from '@/hooks/useSupabaseUser'
import { getOrCreateDefaultFolderId } from '@/lib/library'
import CanvasLayer, { CanvasLayerRef } from './CanvasLayer'
import { ArrowLeft, Eraser, Wand2, Save, Loader2, X, Plus, RefreshCw, Scissors, Paintbrush, Brain, Trash2, Maximize } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface ImageEditorProps {
  imageId: string
}

type ImageSource = 'mood_board_items' | 'folder_items'

interface ImageDetails {
  id: string
  image_url: string
  name: string | null
  description: string | null
  source: ImageSource
  session_id?: string | null
  folder_id?: string | null
  mask_url?: string | null
}

interface DetectedObject {
    x: number
    y: number
    width: number
    height: number
    label: string
}

export default function ImageEditor({ imageId }: ImageEditorProps) {
  const router = useRouter()
  const { sessionId } = useSession()
  const { user } = useSupabaseUser()
  const [image, setImage] = useState<ImageDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingMeta, setSavingMeta] = useState(false)
  
  // Editor State
  const [toolMode, setToolMode] = useState<'brush' | 'lasso' | 'sam'>('brush')
  const [brushSize, setBrushSize] = useState(20)
  const [prompt, setPrompt] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  
  // SAM & Interaction State
  const [samMaskBase64, setSamMaskBase64] = useState<string | null>(null)
  const [isMaskVisible, setIsMaskVisible] = useState(false)
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([])
  const [hoveredObjectIndex, setHoveredObjectIndex] = useState<number | null>(null)
  const [selectedObjectIndex, setSelectedObjectIndex] = useState<number | null>(null)
  const [menuPosition, setMenuPosition] = useState<{x: number, y: number} | null>(null)
  const [objectPrompt, setObjectPrompt] = useState('')

  // Metadata State
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const canvasRef = useRef<CanvasLayerRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 512, height: 512 })

  useEffect(() => {
    fetchImage()
  }, [imageId])

  // ... (fetchImage remains same)

  async function fetchImage() {
    setLoading(true)
    const { data: boardData, error: boardError } = await supabase
      .from('mood_board_items')
      .select('id, image_url, name, description, session_id, folder_id, mask_url')
      .eq('id', imageId)
      .maybeSingle()

    if (boardError) {
      console.error('Error fetching mood board item:', boardError)
    }

    if (boardData) {
      setImage({
        ...boardData,
        source: 'mood_board_items',
        session_id: boardData.session_id,
        folder_id: boardData.folder_id,
        mask_url: boardData.mask_url
      })
      setName(boardData.name || '')
      setDescription(boardData.description || '')
      if (boardData.mask_url) {
          setTimeout(() => canvasRef.current?.drawBase64Mask(boardData.mask_url!), 500)
      }
      setLoading(false)
      return
    }

    const { data: libraryData, error: libraryError } = await supabase
      .from('folder_items')
      .select('id, image_url, title, description, folder_id, mask_url')
      .eq('id', imageId)
      .maybeSingle()

    if (libraryData) {
      setImage({
        id: libraryData.id,
        image_url: libraryData.image_url,
        name: libraryData.title,
        description: libraryData.description,
        source: 'folder_items',
        folder_id: libraryData.folder_id,
        mask_url: libraryData.mask_url
      })
      setName(libraryData.title || '')
      setDescription(libraryData.description || '')
      if (libraryData.mask_url) {
          setTimeout(() => canvasRef.current?.drawBase64Mask(libraryData.mask_url!), 500)
      }
    }
    setLoading(false)
  }

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current
        setDimensions({ width: clientWidth, height: clientHeight })
    }
  }

  async function uploadBase64Image(base64Data: string, pathPrefix: string) {
    const res = await fetch(base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`)
    const blob = await res.blob()
    const fileName = `${pathPrefix}/${Math.random()}.png`
    const { error } = await supabase.storage.from('uploads').upload(fileName, blob)
    if (error) throw error
    const { data } = supabase.storage.from('uploads').getPublicUrl(fileName)
    return data.publicUrl
  }
  
  async function saveMaskToDB(base64Mask: string) {
      if (!image) return
      try {
        const url = await uploadBase64Image(base64Mask, (image.session_id||'temp') + '/masks')
        const table = image.source === 'folder_items' ? 'folder_items' : 'mood_board_items'
        await supabase.from(table).update({ mask_url: url }).eq('id', image.id)
      } catch (e) { console.error(e) }
  }

  async function handleGenerate(overridePrompt?: string, overrideMask?: string) {
      const finalPrompt = overridePrompt || prompt
      const finalMask = overrideMask || canvasRef.current?.getMaskDataURL()?.split(',')[1] || null
      
      if (!finalPrompt) return
      setIsProcessing(true)
      // Do NOT clear generatedImage here if we want to show a loading state over the old one, 
      // but for now let's clear it so we don't see the old result while waiting for new.
      // actually, let's keep it null so the main image shows.
      setGeneratedImage(null)

      try {
        let imageBase64 = null
        // If we have a generated image "committed" but not saved, we might want to edit THAT.
        // But here we are editing the BASE image.
        // If the user wants to chain edits, they should "Save" (Replace Original) first.
        
        if (image?.image_url) {
            const response = await fetch(image.image_url)
            const blob = await response.blob()
            imageBase64 = await new Promise<string>((resolve) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve(reader.result as string)
                reader.readAsDataURL(blob)
            })
        }

        const response = await fetch('/api/interact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: finalPrompt,
                mask: finalMask,
                image: imageBase64,
                model: 'gemini-3-pro-image-preview'
            })
        })

        const data = await response.json()
        if (data.success && data.imageData) {
            setGeneratedImage(data.imageData)
            setSelectedObjectIndex(null) // Deselect object after generation
            setMenuPosition(null)
            setObjectPrompt('')
        } else {
            alert(`Error: ${data.details || data.error}`)
        }
      } catch (err) {
          console.error(err)
          alert('Generation failed')
      } finally {
        setIsProcessing(false)
      }
  }

  async function handleSAMSegment(textPrompt: any) {
    if (!image) return
    setIsProcessing(true)
    setToolMode('brush') 
    setDetectedObjects([])
    
    try {
        const apiRes = await fetch('/api/segment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: image.image_url, prompt: textPrompt })
        })
        
        const responseText = await apiRes.text()
        let data
        try { data = JSON.parse(responseText) } catch (e) { throw new Error(responseText) }

        console.log('Roboflow Response:', data)

        if (apiRes.ok && data.success && data.result) {
            const outputs = data.result.outputs
            const objects: DetectedObject[] = []
            
            if (outputs && Array.isArray(outputs)) {
                let foundMask = false
                outputs.forEach((out: any) => {
                    Object.values(out).forEach((val: any) => {
                        if (val && val.type === 'base64' && val.value) {
                            canvasRef.current?.drawBase64Mask(val.value)
                            saveMaskToDB(val.value)
                            setSamMaskBase64(val.value)
                            setIsMaskVisible(true)
                            foundMask = true
                        }
                    })
                    if (!foundMask && out.image && out.image.type === 'base64') {
                        canvasRef.current?.drawBase64Mask(out.image.value)
                        saveMaskToDB(out.image.value)
                        setSamMaskBase64(out.image.value)
                        setIsMaskVisible(true)
                        foundMask = true
                    }

                    if (typeof out.x === 'number' && typeof out.y === 'number') {
                        objects.push({
                            x: out.x - out.width / 2, 
                            y: out.y - out.height / 2,
                            width: out.width,
                            height: out.height,
                            label: out.class || 'object'
                        })
                    }
                    if (out.predictions && Array.isArray(out.predictions)) {
                        out.predictions.forEach((p: any) => {
                             objects.push({
                                x: p.x - p.width / 2,
                                y: p.y - p.height / 2,
                                width: p.width,
                                height: p.height,
                                label: p.class || 'object'
                            })
                        })
                    }
                })
                
                if (objects.length > 0) {
                    setDetectedObjects(objects)
                    setToolMode('sam') 
                } 
            } 
        } 
    } catch (err) {
        console.error('SAM Error:', err)
        alert('Segmentation failed.')
    } finally {
        setIsProcessing(false)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      // If we have a selection, don't update hover or menu
      if (selectedObjectIndex !== null) return
      
      if (detectedObjects.length === 0 || toolMode !== 'sam') return

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const hitIndex = detectedObjects.findIndex(obj => 
          x >= obj.x && x <= obj.x + obj.width &&
          y >= obj.y && y <= obj.y + obj.height
      )

      if (hitIndex !== -1) {
          if (hoveredObjectIndex !== hitIndex) {
              setHoveredObjectIndex(hitIndex)
              // Don't set menu position on hover anymore, only on click
              
              if (samMaskBase64) {
                  canvasRef.current?.clear()
                  canvasRef.current?.drawBase64Mask(samMaskBase64) 
                  const obj = detectedObjects[hitIndex]
                  setTimeout(() => canvasRef.current?.highlightBox(obj.x, obj.y, obj.width, obj.height), 10)
              }
          }
      } else {
          if (hoveredObjectIndex !== null) {
              setHoveredObjectIndex(null)
              if (samMaskBase64) {
                  canvasRef.current?.clear()
                  canvasRef.current?.drawBase64Mask(samMaskBase64)
              }
          }
      }
  }
  
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (detectedObjects.length === 0 || toolMode !== 'sam') return
      
      // If we already have a selection, clicking elsewhere (or same) might verify
      // For now, let's allow re-clicking to select/move
      
      if (hoveredObjectIndex !== null) {
          setSelectedObjectIndex(hoveredObjectIndex)
          setMenuPosition({ x: e.clientX, y: e.clientY })
      } else {
          // Clicked outside, clear selection
          setSelectedObjectIndex(null)
          setMenuPosition(null)
          setObjectPrompt('')
      }
  }

  async function handleObjectSubmit(e: React.FormEvent) {
      e.preventDefault()
      if (selectedObjectIndex === null || !objectPrompt.trim()) return
      
      const obj = detectedObjects[selectedObjectIndex]
      
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = dimensions.width
      maskCanvas.height = dimensions.height
      const mCtx = maskCanvas.getContext('2d')
      if (!mCtx) return
      
      mCtx.fillStyle = 'black'
      mCtx.fillRect(0, 0, dimensions.width, dimensions.height)
      
      mCtx.fillStyle = 'white'
      mCtx.fillRect(obj.x, obj.y, obj.width, obj.height)
      
      const maskBase64 = maskCanvas.toDataURL('image/png').split(',')[1]
      
      handleGenerate(objectPrompt, maskBase64)
  }
  
  const clearMask = () => canvasRef.current?.clear()
  
  const toggleSamMask = () => {
      if (!samMaskBase64) return
      if (isMaskVisible) {
          clearMask()
          setIsMaskVisible(false)
      } else {
          canvasRef.current?.drawBase64Mask(samMaskBase64)
          setIsMaskVisible(true)
      }
  }

  async function getTargetFolderId() {
    if (image?.folder_id) return image.folder_id
    if (!user?.id) return null
    return await getOrCreateDefaultFolderId(user.id)
  }

  async function getNextOrderIndex(targetSessionId: string) {
    const { data } = await supabase
      .from('mood_board_items')
      .select('order_index')
      .eq('session_id', targetSessionId)

    const orderIndexes = (data ?? [])
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        if (!('order_index' in row)) return null
        const value = (row as { order_index?: unknown }).order_index
        return typeof value === 'number' ? value : null
      })
      .filter((n): n is number => typeof n === 'number')

    return orderIndexes.length > 0 ? Math.max(...orderIndexes) + 1 : 0
  }

  async function handleAddToBoard() {
      if (!generatedImage || !image) return
      const targetSessionId = image.session_id ?? sessionId
      if (!targetSessionId) {
        alert('No active vibe board session.')
        return
      }
      setActionLoading(true)
      try {
          const folderId = await getTargetFolderId()
          const pathPrefix = user?.id && folderId ? `${user.id}/${folderId}` : targetSessionId
          const publicUrl = await uploadBase64Image(generatedImage, pathPrefix)

          if (folderId && user?.id) {
            const { error: libErr } = await supabase.from('folder_items').insert({
              folder_id: folderId,
              image_url: publicUrl,
              title: `${name} (Edit)`,
              description: `Edit of ${name}: ${prompt}`,
              added_by: user.id,
            })
            if (libErr) console.error('Failed to add edited image to library:', libErr)
          }
          
          const newOrder = await getNextOrderIndex(targetSessionId)

          const { error } = await supabase
            .from('mood_board_items')
            .insert({
                session_id: targetSessionId,
                image_url: publicUrl,
                order_index: newOrder,
                is_curated: false,
                name: `${name} (Edit)`,
                description: `Edit of ${name}: ${prompt}`,
                added_by: user?.id ?? null,
                folder_id: folderId,
            })

          if (error) throw error
          
          alert('Added to Vibe Board!')
          setGeneratedImage(null)
      } catch (err) {
          console.error('Failed to add to board', err)
          alert('Failed to add image to board.')
      } finally {
          setActionLoading(false)
      }
  }

  async function handleReplacePhoto() {
      if (!generatedImage || !image) return
      setActionLoading(true)
      try {
          const folderId = await getTargetFolderId()
          const pathPrefix = user?.id && folderId ? `${user.id}/${folderId}` : (image.session_id || sessionId || 'uploads')
          const publicUrl = await uploadBase64Image(generatedImage, pathPrefix)
          
          // 1. Update the PRIMARY source record
          const table = image.source === 'folder_items' ? 'folder_items' : 'mood_board_items'
          const { error: primaryError } = await supabase
            .from(table)
            .update({
              image_url: publicUrl,
              description: description ? `${description}\n\nLast Edit: ${prompt}` : `Edit: ${prompt}`,
            })
            .eq('id', image.id)
          
          if (primaryError) throw primaryError

          // 2. Try to update corresponding record in the OTHER table (if it exists)
          // If we edited a folder item, update any mood board item using that same image
          // If we edited a mood board item, update any folder item using that same image
          // (This keeps them in sync if they share the same URL, which they often do)
          const otherTable = image.source === 'folder_items' ? 'mood_board_items' : 'folder_items'
          await supabase
            .from(otherTable)
            .update({ image_url: publicUrl })
            .eq('image_url', image.image_url) // Use OLD url to find matches

          alert('Photo Replaced!')
          setGeneratedImage(null)
          
          // Force navigation back to home to see the updated board
          router.push('/')
          router.refresh()
          
      } catch (err) {
          console.error('Failed to replace photo', err)
          alert('Failed to replace photo.')
      } finally {
          setActionLoading(false)
      }
  }

  // RENAMED FUNCTION to avoid any weird cache collision
  async function onSaveMetadata() {
    if (!imageId) return
    setSavingMeta(true)
    const table = image?.source === 'folder_items' ? 'folder_items' : 'mood_board_items'
    const update =
      table === 'folder_items'
        ? { title: name, description } 
        : { name, description }
    const { error } = await supabase.from(table).update(update).eq('id', imageId)

    if (error) {
      console.error('Error updating metadata:', error)
      alert('Failed to save metadata.')
    } 
    setSavingMeta(false)
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin" /></div>
  if (!image) return <div className="p-8">Image not found</div>

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden relative">
      
      {/* Object Interaction Menu */}
      {menuPosition && selectedObjectIndex !== null && (
          <div 
            className="fixed z-50 bg-white shadow-xl rounded-lg p-3 border border-gray-200 animate-in fade-in zoom-in duration-200"
            style={{ left: menuPosition.x + 15, top: menuPosition.y }}
          >
              <form onSubmit={handleObjectSubmit} className="flex flex-col gap-2 w-64">
                  <span className="text-xs font-semibold text-gray-500">Edit Object</span>
                  <input 
                      autoFocus
                      className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-black"
                      placeholder="Replace object with..."
                      value={objectPrompt}
                      onChange={(e) => setObjectPrompt(e.target.value)}
                  />
                  <button type="submit" className="bg-black text-white text-xs py-1 rounded hover:bg-gray-800">
                      Generate
                  </button>
              </form>
          </div>
      )}

      {/* Sidebar & Canvas Layout */}
      <div className="w-80 bg-white border-r p-6">
          <Link href="/" className="flex items-center text-sm mb-4"><ArrowLeft className="w-4 h-4 mr-1"/> Back</Link>
          <div className="space-y-4">
              <input value={name} onChange={e=>setName(e.target.value)} className="w-full border p-2 rounded" placeholder="Name"/>
              <textarea value={description} onChange={e=>setDescription(e.target.value)} className="w-full border p-2 rounded" placeholder="Desc"/>
              <button onClick={onSaveMetadata} className="w-full bg-black text-white p-2 rounded flex justify-center"><Save className="w-4 h-4 mr-2"/> Save</button>
          </div>
      </div>

      <div className="flex-1 bg-gray-100 flex items-center justify-center p-8 overflow-auto">
        <div 
            className="relative inline-block shadow-2xl rounded-lg overflow-hidden bg-white"
            onMouseMove={handleMouseMove} // Mouse tracking for objects
            onClick={handleCanvasClick}
            onMouseLeave={() => { 
                setHoveredObjectIndex(null); 
                // Only clear selection if we haven't locked it, but here we only lock on click.
                // So on mouse leave we just stop hovering.
            }}
        >
          {/* Main Image or Generated Image Preview */}
          <img 
            src={generatedImage || image.image_url} 
            crossOrigin="anonymous"
            className="block max-h-[80vh] max-w-[80vw] w-auto h-auto pointer-events-none select-none"
            onLoad={(e) => {
                const img = e.currentTarget
                setDimensions({ width: img.offsetWidth, height: img.offsetHeight })
            }}
          />
          
          {/* Only show Canvas Layer (Masks) if we are NOT previewing a result */}
          {!generatedImage && (
              <CanvasLayer
                ref={canvasRef}
                width={dimensions.width}
                height={dimensions.height}
                brushSize={brushSize}
                mode={toolMode === 'sam' ? 'brush' : toolMode} 
                className="absolute top-0 left-0 opacity-70"
              />
          )}
          
          {/* Apply / Discard Overlay for Generated Image */}
          {generatedImage && (
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex justify-center gap-4 animate-in slide-in-from-bottom-4">
                  <button 
                      onClick={() => setGeneratedImage(null)} 
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded backdrop-blur-sm border border-white/20"
                  >
                      Discard
                  </button>
                  <button 
                      onClick={handleAddToBoard} 
                      disabled={actionLoading}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded backdrop-blur-sm border border-white/20 disabled:opacity-50 flex items-center gap-2"
                  >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : null} Add New
                  </button>
                  <button 
                      onClick={handleReplacePhoto} 
                      disabled={actionLoading}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded shadow-lg disabled:opacity-50 flex items-center gap-2"
                  >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : null} Replace Original
                  </button>
              </div>
          )}
        </div>

        {/* Toolbar (Hide if showing preview) */}
        {!generatedImage && (
            <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-white/90 p-2 rounded-full shadow-lg flex items-center gap-4 z-20">
                 <div className="flex bg-gray-200 rounded-full p-1">
                     <button onClick={() => setToolMode('brush')} className={`p-2 rounded-full ${toolMode === 'brush' ? 'bg-white' : ''}`}><Paintbrush className="w-4 h-4" /></button>
                     <button onClick={() => setToolMode('lasso')} className={`p-2 rounded-full ${toolMode === 'lasso' ? 'bg-white' : ''}`}><Scissors className="w-4 h-4" /></button>
                     <button onClick={() => {
                         if (samMaskBase64) {
                             if (isMaskVisible) { clearMask(); setIsMaskVisible(false) }
                             else { canvasRef.current?.drawBase64Mask(samMaskBase64); setIsMaskVisible(true) }
                         } else {
                             handleSAMSegment(["object"])
                         }
                     }} className={`p-2 rounded-full ${toolMode === 'sam' ? 'bg-white' : ''}`}>
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Brain className="w-4 h-4"/>}
                     </button>
                 </div>
                 {toolMode === 'brush' && <input type="range" min="5" max="100" value={brushSize} onChange={e=>setBrushSize(parseInt(e.target.value))} className="w-24"/>}
                 <button onClick={clearMask}><Eraser className="w-4 h-4"/></button>
            </div>
        )}
      </div>

      {/* Right Sidebar */}
      <div className="w-80 bg-white border-l p-6 flex flex-col">
          <h3 className="font-semibold mb-4">Edit</h3>
          <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} className="w-full h-32 border p-2 rounded mb-4" placeholder="Describe edits..."/>
          <button onClick={()=>handleGenerate()} className="w-full bg-blue-600 text-white p-3 rounded flex justify-center items-center gap-2 mb-2">
              {isProcessing ? <Loader2 className="animate-spin"/> : <Wand2 className="w-4 h-4"/>} Generate
          </button>
          {toolMode === 'lasso' && (
              <button onClick={()=>{setPrompt("Remove background"); handleGenerate("Remove background")}} className="w-full border-2 border-black p-3 rounded flex justify-center items-center gap-2">
                  <Scissors className="w-4 h-4"/> Remove BG
              </button>
          )}
      </div>
    </div>
  )
}
