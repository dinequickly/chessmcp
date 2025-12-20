import { NextResponse } from 'next/server'

// Helper to strip data:image/...;base64, prefix
function stripBase64Prefix(dataUrl: string) {
  if (!dataUrl) return ''
  return dataUrl.split(',')[1] || dataUrl
}

type InteractionInput =
  | { type: 'image'; data: string; mime_type: string }
  | { type: 'text'; text: string }

type InteractionOutput = { type: string; data?: string; mime_type?: string }
type InteractionResponse = { outputs?: InteractionOutput[] }

export async function POST(request: Request) {
  try {
    const { prompt, image, mask, model } = await request.json()

    if (!prompt) return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    
    // Construct Input Array based on what's provided
    const inputPayload: InteractionInput[] = []

    // 1. Base Image (if present)
    if (image) {
        inputPayload.push({
            type: "image",
            data: stripBase64Prefix(image),
            mime_type: "image/png" // Assuming PNG for now from canvas/upload
        })
    }

    // 2. Mask (if present)
    if (mask) {
        inputPayload.push({
            type: "image",
            data: stripBase64Prefix(mask),
            mime_type: "image/png",
            // role: "mask" // Removed due to API error: no such field 'role'
        })
    }

    // 3. Text Prompt (Always present)
    inputPayload.push({
        type: "text",
        text: prompt
    })

    const apiPayload = {
      model: model || "gemini-3-pro-image-preview",
      input: inputPayload,
      response_modalities: ["IMAGE"]
    }

    console.log('--- Sending Interaction Request ---')
    // console.log(JSON.stringify(apiPayload, null, 2)) 

    const apiKey = process.env.GEMINI_API_KEY || process.env.INTERACTION_API_KEY

    if (!apiKey) {
        return NextResponse.json({ 
            success: false, 
            error: 'API Key not configured. Set GEMINI_API_KEY in .env.local' 
        }, { status: 500 })
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/interactions`

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify(apiPayload)
    })

    if (!response.ok) {
        const errorText = await response.text()
        console.error('Gemini API Error:', response.status, errorText)
        return NextResponse.json({ error: `Gemini API Error: ${response.status}`, details: errorText }, { status: response.status })
    }

    const data = await response.json()
    
    // Extract Image Output
    // Expected structure: { outputs: [ { type: "image", data: "base64...", mime_type: "..." } ] }
    const typedData: InteractionResponse = data
    const imageOutput = typedData.outputs?.find(
      (o): o is Required<Pick<InteractionOutput, 'data' | 'mime_type'>> & { type: 'image' } =>
        o.type === 'image' && typeof o.data === 'string' && typeof o.mime_type === 'string',
    )

    if (imageOutput) {
        return NextResponse.json({
            success: true,
            imageData: `data:${imageOutput.mime_type};base64,${imageOutput.data}` // Re-add prefix for frontend display
        })
    } else {
        return NextResponse.json({ error: 'No image generated', raw: data })
    }

  } catch (error) {
    console.error('Interaction API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
