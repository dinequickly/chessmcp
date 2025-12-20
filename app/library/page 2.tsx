'use client'

import React, { useState, useEffect } from 'react'
import { useSession } from '@/hooks/useSession'
import { useSupabaseUser } from '@/hooks/useSupabaseUser'
import { supabase } from '@/lib/supabaseClient'
import FileUploader from '@/components/FileUploader'
import Link from 'next/link'
import { ArrowLeft, Search, Image as ImageIcon, Loader2, Upload, ScanSearch } from 'lucide-react'

interface LibraryItem {
  id: string
  image_url: string
  name: string | null
  created_at: string
}

export default function LibraryPage() {
  const { sessionId, loading: sessionLoading } = useSession()
  const { user, loading: userLoading } = useSupabaseUser()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [fetching, setFetching] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Object Search State
  const [objectSearchQuery, setObjectSearchQuery] = useState('')
  const [objectSearchResults, setObjectSearchResults] = useState<LibraryItem[]>([])
  const [isSearchingObject, setIsSearchingObject] = useState(false)

  useEffect(() => {
    if (sessionId) fetchLibraryItems()
  }, [sessionId])

  async function fetchLibraryItems() {
    if (!sessionId) return
    setFetching(true)
    const { data, error } = await supabase
      .from('mood_board_items')
      .select('id, image_url, name, created_at, mask_url') // Fetch mask_url as well
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching library:', error)
    } else {
      setItems(data || [])
    }
    setFetching(false)
  }

  // Function to find a LibraryItem by its ID or mask_url
  const findLibraryItem = async (value: string, type: 'id' | 'mask_url'): Promise<LibraryItem | null> => {
    const column = type === 'id' ? 'id' : 'mask_url';
    
    // Search mood_board_items
    const { data: moodBoardItem } = await supabase
      .from('mood_board_items')
      .select('id, image_url, name, created_at')
      .eq(column, value)
      .maybeSingle();

    if (moodBoardItem) {
        return moodBoardItem as LibraryItem;
    }

    // Search folder_items
    const { data: folderItem } = await supabase
      .from('folder_items')
      .select('id, image_url, title, created_at') // Removed 'as name' aliasing
      .eq(column, value)
      .maybeSingle();

    if (folderItem) {
        return { ...folderItem, name: folderItem.title } as LibraryItem; // Manually alias title to name for consistency
    }

    return null;
  };

  // Function to find a LibraryItem by its image_url
  const findLibraryItemByImageUrl = async (imageUrl: string): Promise<LibraryItem | null> => {
    // Search mood_board_items
    const { data: moodBoardItem } = await supabase
      .from('mood_board_items')
      .select('id, image_url, name, created_at')
      .eq('image_url', imageUrl)
      .maybeSingle();

    if (moodBoardItem) {
        return moodBoardItem as LibraryItem;
    }

    // Search folder_items
    const { data: folderItem } = await supabase
      .from('folder_items')
      .select('id, image_url, title, created_at') // Select 'title' directly
      .eq('image_url', imageUrl)
      .maybeSingle();

    if (folderItem) {
        return { ...folderItem, name: folderItem.title } as LibraryItem; // Manually alias title to name
    }

    return null;
  };


  const performObjectSearch = async () => {
    if (!objectSearchQuery.trim()) return
    
    setIsSearchingObject(true)
    setObjectSearchResults([])
    // Convert input to CSV keywords
    const keywords = objectSearchQuery.trim().split(/[\s,]+/).filter(Boolean).join(',')
    
    try {
        const response = await fetch(`https://maxipad.app.n8n.cloud/webhook/457696f7-6548-483e-8650-acd779cbbc60?user_input=${encodeURIComponent(keywords)}`)
        
        if (response.ok) {
            const data = await response.json()
            console.log("Raw object search response:", data);
            
            const itemsToFind: { value: string, type: 'id' | 'mask_url' | 'storage_path' | 'full_url' }[] = [];

            const processEntry = (entry: any) => {
                if (typeof entry === 'string') {
                    if (entry.startsWith('http')) {
                         itemsToFind.push({ value: entry, type: 'full_url' });
                    } else if (entry.startsWith('uploads/')) { 
                        itemsToFind.push({ value: entry, type: 'storage_path' });
                    } else {
                        itemsToFind.push({ value: entry, type: 'mask_url' });
                    }
                } else if (typeof entry === 'object' && entry !== null) {
                    // Check for 'Link' or 'link' array or string
                    const link = entry.Link || entry.link;
                    if (link) {
                        const links = Array.isArray(link) ? link : [link];
                        links.forEach((url: string) => {
                             if (typeof url === 'string' && url.startsWith('http')) {
                                 itemsToFind.push({ value: url, type: 'full_url' });
                             }
                        });
                    }

                    if (entry.imageid) {
                         itemsToFind.push({ value: entry.imageid, type: 'id' });
                    } else if (entry.mask_url) {
                         itemsToFind.push({ value: entry.mask_url, type: 'mask_url' });
                    } else if (entry.path && typeof entry.path === 'string' && entry.path.startsWith('uploads/')) {
                        itemsToFind.push({ value: entry.path, type: 'storage_path' });
                    } else if (entry.id && typeof entry.id === 'string') {
                        if (entry.id.startsWith('http')) {
                             itemsToFind.push({ value: entry.id, type: 'full_url' });
                        } else if (entry.id.includes('/')) {
                             itemsToFind.push({ value: entry.id, type: 'storage_path' });
                        } else {
                             itemsToFind.push({ value: entry.id, type: 'id' });
                        }
                    }
                }
            }
    
            if (Array.isArray(data)) {
                data.forEach(processEntry);
            } else {
                processEntry(data);
            }

            console.log("Parsed items to find:", itemsToFind);

            const foundItems: LibraryItem[] = [];
            for (const item of itemsToFind) {
                if (item.type === 'full_url') {
                    let publicUrl = item.value;
                    
                    // Fix Supabase URL if missing '/public/' segment
                    // Transforms: .../storage/v1/object/uploads/... -> .../storage/v1/object/public/uploads/...
                    if (publicUrl.includes('/storage/v1/object/uploads/') && !publicUrl.includes('/storage/v1/object/public/uploads/')) {
                         publicUrl = publicUrl.replace('/storage/v1/object/uploads/', '/storage/v1/object/public/uploads/');
                         console.log(`Fixed Supabase URL: ${publicUrl} (Original: ${item.value})`);
                    }

                    console.log(`Processing full URL: ${publicUrl}`);
                    const foundItem = await findLibraryItemByImageUrl(publicUrl);
                    if (foundItem) {
                        foundItems.push(foundItem);
                    } else {
                        console.log(`Item not found in DB, adding as temporary item from URL.`);
                        foundItems.push({
                            id: '', 
                            image_url: publicUrl,
                            name: 'Search Result', 
                            created_at: new Date().toISOString()
                        });
                    }
                } else if (item.type === 'storage_path') {
                    // Normalize path: strip 'uploads/' prefix if present, as it's the bucket name
                    let relativePath = item.value;
                    if (relativePath.startsWith('uploads/')) {
                        relativePath = relativePath.substring('uploads/'.length);
                    }
                    // Remove leading slashes
                    relativePath = relativePath.replace(/^\/+/, '');
                    // Remove trailing slashes
                    relativePath = relativePath.replace(/\/+$/, '');

                    console.log(`Processing storage path (item.value): ${item.value}`);
                    console.log(`Normalized relativePath: ${relativePath}`);

                    // Strategy 1: Treat as a folder and list contents
                    let { data: files, error: storageError } = await supabase.storage
                        .from('uploads')
                        .list(relativePath, { limit: 100 });

                    // Fallback: If 0 files, try adding a trailing slash (some buckets/configs might prefer it)
                    if (!storageError && (!files || files.length === 0)) {
                         console.log("No files found with clean path, trying with trailing slash...");
                         const { data: filesWithSlash, error: errorSlash } = await supabase.storage
                            .from('uploads')
                            .list(relativePath + '/', { limit: 100 });
                         
                         if (!errorSlash && filesWithSlash && filesWithSlash.length > 0) {
                             files = filesWithSlash;
                             // Update relativePath to include slash for URL construction if needed
                             // But usually constructing URL is path + / + name, so clean path is fine.
                         }
                    }

                    if (storageError) {
                         console.error("Error listing files:", storageError);
                    }

                    if (files && files.length > 0) {
                        console.log(`Found ${files.length} files in folder: ${relativePath}`, files);
                        for (const file of files) {
                            if (file.name === '.emptyFolderPlaceholder') continue; 
                            
                            // constructing path: Ensure we don't double slash if relativePath is empty
                            const filePath = relativePath ? `${relativePath}/${file.name}` : file.name;
                            console.log(`Input to getPublicUrl (from folder file): ${filePath}`);

                            const publicUrl = supabase.storage
                                .from('uploads')
                                .getPublicUrl(filePath).data?.publicUrl;
                            
                            console.log(`Public URL constructed (from folder file): ${publicUrl}`);
                            if (publicUrl) {
                                const foundItem = await findLibraryItemByImageUrl(publicUrl);
                                if (foundItem) {
                                    foundItems.push(foundItem);
                                } else {
                                    // Item not found in DB, but exists in storage. Create a temp item.
                                    console.log(`Item not found in DB, adding as temporary item: ${file.name}`);
                                    foundItems.push({
                                        id: '', 
                                        image_url: publicUrl,
                                        name: file.name,
                                        created_at: file.created_at || new Date().toISOString()
                                    });
                                }
                            }
                        }
                    } else {
                        // Strategy 2: Treat as a direct file
                        // If listing failed or returned empty (and it's not just an empty folder), try direct URL
                        console.log(`No files found in folder or list error. Trying as direct file.`);
                        console.log(`Input to getPublicUrl (direct file): ${relativePath}`);
                        
                        const publicUrl = supabase.storage
                            .from('uploads')
                            .getPublicUrl(relativePath).data?.publicUrl;
                        
                        console.log(`Public URL constructed (direct file): ${publicUrl}`);
                        const foundItem = await findLibraryItemByImageUrl(publicUrl);
                        if (foundItem) {
                            foundItems.push(foundItem);
                        }
                    }
                } else {
                    const result = await findLibraryItem(item.value, item.type);
                    if (result) {
                        foundItems.push(result);
                    }
                }
            }
            console.log("Final found items before setting state:", foundItems);
            setObjectSearchResults(foundItems);
            
        } else {
            console.error("Object search failed with status:", response.status)
        }
    } catch (error) {
        console.error("Object search error:", error)
    } finally {
        setIsSearchingObject(false)
    }
  }

  const filteredItems = items.filter(item => 
    item.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    !searchQuery
  )

  if (sessionLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6">
          <Link href="/" className="flex items-center text-sm text-gray-500 hover:text-gray-900 w-fit">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Vibe Board
          </Link>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900">Library</h1>
                    <p className="text-gray-500">Manage your assets and uploads.</p>
                </div>
                
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                    {/* Search By Name */}
                    <div className="relative w-full md:w-64">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-black focus:border-black sm:text-sm"
                            placeholder="Search by name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Search By Object */}
                    <div className="relative w-full md:w-64">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <ScanSearch className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-black focus:border-black sm:text-sm"
                            placeholder="Search by object..."
                            value={objectSearchQuery}
                            onChange={(e) => setObjectSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && performObjectSearch()}
                        />
                    </div>
                </div>
            </div>
          </div>
        </header>

        {/* Upload Section */}
        <section>
             <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Upload className="w-5 h-5" /> Upload New
             </h2>
             {sessionId && (
                <FileUploader 
                    sessionId={sessionId} 
                    onUploadComplete={fetchLibraryItems} 
                />
             )}
        </section>

        {/* Object Search Results */}
        {(objectSearchResults.length > 0 || isSearchingObject) && (
            <section className="mb-8 border-b border-gray-200 pb-8">
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <ScanSearch className="w-5 h-5" /> Object Search Results
                </h2>
                
                {isSearchingObject ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="animate-spin h-8 w-8 text-gray-400" />
                    </div>
                ) : objectSearchResults.length === 0 ? (
                    <div className="text-center py-12 text-gray-500 bg-white rounded-lg border border-gray-200">
                        <p>No objects match your search.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {objectSearchResults.map((item) => (
                                <Link 
                                    key={item.id} 
                                    href={`/editor/${item.id}`} 
                                    className="group block relative aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200 hover:shadow-md transition-shadow"
                                >
                                    <img
                                        src={item.image_url}
                                        alt={item.name || 'Search Result'}
                                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                        loading="lazy"
                                    />
                                    {item.name && (
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <p className="text-white text-xs truncate">{item.name}</p>
                                        </div>
                                    )}
                                </Link>
                        ))}
                    </div>
                )}
            </section>
        )}

        {/* Image Grid */}
        <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <ImageIcon className="w-5 h-5" /> Recent Uploads
            </h2>
            
            {fetching ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin h-8 w-8 text-gray-400" />
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="text-center py-12 text-gray-500 bg-white rounded-lg border border-gray-200">
                    <p>{searchQuery ? 'No images match your search.' : 'No images in library yet.'}</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {filteredItems.map((item) => (
                        <Link key={item.id} href={`/editor/${item.id}`} className="group block relative aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200 hover:shadow-md transition-shadow">
                            <img
                                src={item.image_url}
                                alt={item.name || 'Library Item'}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                loading="lazy"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <p className="text-white text-xs truncate">{item.name || 'Untitled'}</p>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </section>

      </div>
    </main>
  )
}