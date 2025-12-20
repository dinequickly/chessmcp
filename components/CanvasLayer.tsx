'use client'

import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react'

interface CanvasLayerProps {
  width: number
  height: number
  brushSize: number
  mode: 'brush' | 'lasso'
  className?: string
}

export interface CanvasLayerRef {
  getMaskDataURL: () => string | null
  clear: () => void
  drawBase64Mask: (base64: string) => void
  drawBox: (x: number, y: number, w: number, h: number) => void
  highlightBox: (x: number, y: number, w: number, h: number) => void
}

const CanvasLayer = forwardRef<CanvasLayerRef, CanvasLayerProps>(({ width, height, brushSize, mode, className }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number, y: number } | null>(null)
  const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null)

  useImperativeHandle(ref, () => ({
    getMaskDataURL: () => {
      if (!canvasRef.current) return null
      return canvasRef.current.toDataURL('image/png')
    },
    clear: () => {
      if (!ctx || !canvasRef.current) return
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    },
    drawBase64Mask: (base64: string) => {
        if (!ctx || !canvasRef.current) return
        console.log('CanvasLayer: drawBase64Mask called with length', base64.length)
        const img = new Image()
        img.onload = () => {
            console.log('CanvasLayer: Mask image loaded, drawing...')
            ctx.drawImage(img, 0, 0, canvasRef.current!.width, canvasRef.current!.height)
        }
        img.onerror = (e) => {
            console.error('CanvasLayer: Failed to load mask image', e)
        }
        
        if (base64.startsWith('data:')) {
            img.src = base64
        } else if (base64.startsWith('/9j/')) {
            img.src = `data:image/jpeg;base64,${base64}`
        } else {
            img.src = `data:image/png;base64,${base64}`
        }
    },
    drawBox: (x: number, y: number, w: number, h: number) => {
        if (!ctx) return
        ctx.save()
        ctx.strokeStyle = '#00FF00'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, w, h)
        ctx.restore()
    },
    highlightBox: (x: number, y: number, w: number, h: number) => {
        if (!ctx) return
        ctx.save()
        ctx.fillStyle = 'rgba(128, 128, 128, 0.5)' // Grey, 50% opacity
        ctx.fillRect(x, y, w, h)
        ctx.restore()
    }
  }))

  useEffect(() => {
    console.log(`CanvasLayer resized: ${width}x${height}`)
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = 'rgba(255, 255, 255, 1)'
    context.fillStyle = 'rgba(255, 255, 255, 1)'
    
    setCtx(context)
  }, [width, height])

  useEffect(() => {
    if (ctx) {
      ctx.lineWidth = mode === 'lasso' ? 2 : brushSize
    }
  }, [brushSize, mode, ctx])

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    let clientX, clientY

    if ('touches' in e) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = (e as React.MouseEvent).clientX
      clientY = (e as React.MouseEvent).clientY
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    }
  }

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true)
    
    if (!ctx) return
    const { x, y } = getCoords(e)
    
    ctx.beginPath()
    ctx.moveTo(x, y)
    
    if (mode === 'brush') {
        ctx.lineTo(x, y)
        ctx.stroke()
    }
    else {
        setStartPos({ x, y })
    }
  }

  const stopDrawing = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    
    if (ctx) {
        if (mode === 'lasso') {
            ctx.closePath()
            ctx.fill() // Fill the lasso shape
            ctx.stroke() // Draw boundary
            setStartPos(null)
        }
        ctx.beginPath()
    }
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !ctx) return

    const { x, y } = getCoords(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCoords(e)
    setMousePos({ x, y })
    if (isDrawing) draw(e)
  }

  return (
    <div className={`${className}`} style={{ width, height, touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-full cursor-none"
        onMouseDown={startDrawing}
        onMouseUp={stopDrawing}
        onMouseOut={stopDrawing}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setMousePos(null)}

        onTouchStart={startDrawing}
        onTouchEnd={stopDrawing}
        onTouchMove={draw}
      />
      {mousePos && (
        <div
          className="pointer-events-none absolute rounded-full z-50"
          style={{
            left: mousePos.x,
            top: mousePos.y,
            width: mode === 'lasso' ? 16 : brushSize,
            height: mode === 'lasso' ? 16 : brushSize,
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(59, 130, 246, 0.4)',
            border: '2px solid rgba(37, 99, 235, 0.8)',
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.5)',
          }}
        />
      )}
    </div>
  )
})

CanvasLayer.displayName = 'CanvasLayer'

export default CanvasLayer