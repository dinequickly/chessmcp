'use client'

import React, { useState, useEffect } from 'react'
import { useSession } from '@/hooks/useSession'
import { useSupabaseUser } from '@/hooks/useSupabaseUser'
import { supabase } from '@/lib/supabaseClient'
import { getOrCreateDefaultFolderId } from '@/lib/library'
import FileUploader from '@/components/FileUploader'
import AuthDialog from '@/components/AuthDialog'
import Link from 'next/link'
import { ArrowLeft, Search, Image as ImageIcon, Loader2, Upload, ScanSearch, LogIn, LogOut } from 'lucide-react'

interface LibraryItem {
  id: string
  image_url: string
  name: string | null
  created_at: string
}

export default function LibraryPage() {
  const { sessionId, loading: sessionLoading, error: sessionError } = useSession()
  const { user, loading: userLoading, error: userError } = useSupabaseUser()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [fetching, setFetching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Object Search State
  const [objectSearchQuery, setObjectSearchQuery] = useState('')
  const [objectSearchResults, setObjectSearchResults] = useState<LibraryItem[]>([])
  const [isSearchingObject, setIsSearchingObject] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(null)

  useEffect(() => {
    if (user?.id) {
        getOrCreateDefaultFolderId(user.id).then(setFolderId)
    }
  }, [user?.id])

  useEffect(() => {
    console.log('useEffect triggered - user:', user, 'userLoading:', userLoading, 'sessionId:', sessionId, 'sessionLoading:', sessionLoading)
    if (userError) console.error('User Error:', userError)
    if (sessionError) console.error('Session Error:', sessionError)

    if (user?.id || (!userLoading && sessionId)) {
      console.log('Fetching items (user or session available)')
      fetchLibraryItems()
    } else if (!userLoading && !sessionLoading) {
      // If both loaded but nothing available
      console.log('No user or session - showing empty state')
      setFetching(false)
      setItems([])
    }
  }, [user?.id, userLoading, sessionId, sessionLoading])

  async function handleSignOut() {
    await supabase.auth.signOut()
    window.location.reload()
  }

  async function fetchLibraryItems() {
    setFetching(true)

    // If we have a user, fetch from their folders AND their mood board items
    if (user?.id) {
      console.log('Fetching library items for user:', user.id)
      let combinedItems: LibraryItem[] = []

      // 1. Fetch Folder Items
      const { data: folders, error: foldersError } = await supabase
        .from('folders')
        .select('id')
        .eq('user_id', user.id)

      if (!foldersError && folders && folders.length > 0) {
        const folderIds = folders.map(f => f.id)
        const { data: folderItems } = await supabase
          .from('folder_items')
          .select('id, image_url, title, created_at')
          .in('folder_id', folderIds)
          .order('created_at', { ascending: false })

        if (folderItems) {
            const mappedFolderItems = folderItems.map(item => ({
                id: item.id,
                image_url: item.image_url,
                name: item.title,
                created_at: item.created_at
            }))
            combinedItems = [...combinedItems, ...mappedFolderItems]
        }
      }

      // 2. Fetch Mood Board Items (added_by user)
      const { data: moodItems } = await supabase
        .from('mood_board_items')
        .select('id, image_url, name, created_at')
        .eq('added_by', user.id)
        .order('created_at', { ascending: false })
      
      if (moodItems) {
           const mappedMoodItems = moodItems.map(item => ({
                id: item.id,
                image_url: item.image_url,
                name: item.name,
                created_at: item.created_at
            }))
            combinedItems = [...combinedItems, ...mappedMoodItems]
      }
      
      // Deduplicate by image_url
      const uniqueUrls = new Set()
      const distinctItems: LibraryItem[] = []
      for (const item of combinedItems) {
          if (!uniqueUrls.has(item.image_url)) {
              uniqueUrls.add(item.image_url)
              distinctItems.push(item)
          }
      }
      
      // Sort by date (newest first)
      distinctItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      
      console.log('Final combined items:', distinctItems)
      setItems(distinctItems)
      setFetching(false)
      return
    }

    // Fallback: fetch from mood_board_items for current session
    console.log('Falling back to mood_board_items for session:', sessionId)
    if (sessionId) {
      const { data, error } = await supabase
        .from('mood_board_items')
        .select('id, image_url, name, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })

      console.log('Mood board items query result:', { data, error })

      if (error) {
        console.error('Error fetching mood board items:', error)
        setItems([])
      } else {
        setItems(data || [])
      }
    } else {
      setItems([])
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
        const userIdParam = user?.id ? `&user_id=${user.id}` : '';
        const response = await fetch(`https://maxipad.app.n8n.cloud/webhook/457696f7-6548-483e-8650-acd779cbbc60?user_input=${encodeURIComponent(keywords)}${userIdParam}`)
        
        if (response.ok) {
            const data = await response.json()
            console.log("Raw object search response:", data);
            
            const foundItems: LibraryItem[] = [];

            // Helper to recursively flatten and parse
            const normalizeArray = (input: any): string[] => {
                if (Array.isArray(input)) {
                    return input.flatMap(normalizeArray);
                }
                if (typeof input === 'string') {
                    // Try parsing if it looks like a JSON array
                    if (input.trim().startsWith('[') && input.trim().endsWith(']')) {
                        try {
                            const parsed = JSON.parse(input);
                            return normalizeArray(parsed);
                        } catch (e) {
                            return [input];
                        }
                    }
                    return [input];
                }
                return [];
            };

            const processPairedArrays = async (linkRaw: any, oldRaw: any) => {
                const links = normalizeArray(linkRaw);
                const olds = normalizeArray(oldRaw);

                if (links.length === 0 || olds.length === 0) return;
                
                // We assume the flattened arrays match index-wise, 
                // but if lengths differ, we iterate up to the shorter one.
                const count = Math.min(links.length, olds.length);

                for (let i = 0; i < count; i++) {
                    const maskUrl = links[i];
                    const originalImageUrl = olds[i];

                    if (!originalImageUrl) continue;

                    let publicUrl = originalImageUrl;
                    // Fix Supabase URL if missing '/public/' segment
                    if (publicUrl.includes('/storage/v1/object/uploads/') && !publicUrl.includes('/storage/v1/object/public/uploads/')) {
                         publicUrl = publicUrl.replace('/storage/v1/object/uploads/', '/storage/v1/object/public/uploads/');
                    }

                    // Find the item in the DB using the ORIGINAL image URL
                    const foundItem = await findLibraryItemByImageUrl(publicUrl);
                    
                    if (foundItem) {
                        foundItems.push({
                            ...foundItem,
                            image_url: maskUrl, // Display the mask
                            name: foundItem.name || 'Detected Object'
                        });
                    } else {
                        console.log(`Original item not found in DB: ${publicUrl}`);
                    }
                }
            };

            // Check if data is array and has the structure
            if (Array.isArray(data) && data.length > 0) {
                for (const entry of data) {
                     if (entry.Link && entry.Old) {
                         await processPairedArrays(entry.Link, entry.Old);
                     } else {
                         // ... (fallback omitted)
                     }
                }
            } else if (data.Link && data.Old) {
                // Handle single object response
                await processPairedArrays(data.Link, data.Old);
            }

            console.log("Final found items:", foundItems);
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

  if (sessionLoading || userLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6">
          <div className="flex justify-between items-center w-full">
            <Link href="/" className="flex items-center text-sm text-gray-500 hover:text-gray-900 w-fit">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Vibe Board
            </Link>
            <div>
               {user ? (
                 <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 hidden md:inline">
                      {user.email || 'Anonymous User'}
                    </span>
                    <button 
                      onClick={handleSignOut}
                      className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md flex items-center gap-2 transition-colors"
                    >
                      <LogOut className="w-3 h-3" /> Sign Out
                    </button>
                 </div>
               ) : (
                 <button 
                   onClick={() => setIsAuthOpen(true)}
                   className="text-sm bg-black text-white hover:bg-gray-800 px-3 py-1.5 rounded-md flex items-center gap-2 transition-colors"
                 >
                   <LogIn className="w-3 h-3" /> Sign In
                 </button>
               )}
            </div>
          </div>
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
                    userId={user?.id}
                    folderId={folderId || undefined}
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
                <ImageIcon className="w-5 h-5" /> Storage
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
      <AuthDialog 
        isOpen={isAuthOpen} 
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={() => {
            fetchLibraryItems()
        }}
      />
    </main>
  )
}