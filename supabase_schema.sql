-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Sessions Table
create table if not exists sessions (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Folders Table
create table if not exists folders (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Folder Items Table
create table if not exists folder_items (
  id uuid primary key default uuid_generate_v4(),
  folder_id uuid references folders on delete cascade,
  image_url text not null,
  title text,
  description text,
  mask_url text,
  added_by uuid references auth.users,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Mood Board Items Table
create table if not exists mood_board_items (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid references sessions(id) on delete cascade,
  image_url text not null,
  name text,
  description text,
  mask_url text,
  order_index integer default 0,
  is_curated boolean default false,
  added_by uuid references auth.users,
  folder_id uuid references folders(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Storage Bucket (if not exists)
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

-- Storage Policies (Example: Public Access)
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'uploads' );

create policy "Authenticated Upload"
on storage.objects for insert
with check ( bucket_id = 'uploads' );
