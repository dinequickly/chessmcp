import ImageEditor from '@/components/ImageEditor'

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ImageEditor imageId={id} />
}
