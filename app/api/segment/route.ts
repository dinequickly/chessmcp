import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { imageUrl, prompt } = await request.json()
    const apiKey = process.env.ROBOFLOW_API_KEY

    if (!apiKey) {
        console.error('ROBOFLOW_API_KEY is missing')
        return NextResponse.json({ error: 'ROBOFLOW_API_KEY is not set' }, { status: 500 })
    }
    
    // Basic validation
    if (!apiKey.startsWith('rf_') && apiKey.length < 10) {
         console.warn('Warning: ROBOFLOW_API_KEY does not look like a standard Roboflow key (rf_...).')
    }

    const workspace = "max-7ruiu"
    const workflowId = "sam3"
    
    // Masked Key for logging
    const maskedKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)
    console.log(`Using API Key: ${maskedKey}`)
    console.log(`Targeting Workflow: ${workspace}/${workflowId} via serverless.roboflow.com`)

    // Correct Endpoint from user snippet
    const url = `https://serverless.roboflow.com/${workspace}/workflows/${workflowId}`
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: apiKey,
            inputs: {
                "image": { "type": "url", "value": imageUrl },
                "param": prompt
            }
        })
    })

    const responseText = await response.text()
    console.log(`Roboflow Response Status: ${response.status}`)
    console.log(`Roboflow Response Body: ${responseText.substring(0, 500)}...`) // Log first 500 chars

    if (!response.ok) {
        return NextResponse.json({ error: `Roboflow Error: ${response.status}`, details: responseText }, { status: response.status })
    }

    let output
    try {
        output = JSON.parse(responseText)
    } catch (e) {
        console.error('Failed to parse Roboflow JSON:', e)
        return NextResponse.json({ error: 'Invalid JSON response from Roboflow', details: responseText }, { status: 500 })
    }

    // Return the parsed output
    return NextResponse.json({ success: true, result: output })

  } catch (error) {
    console.error('Segmentation API Error:', error)
    return NextResponse.json({ error: 'Failed to process image' }, { status: 500 })
  }
}
