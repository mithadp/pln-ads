import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ─────────────────────────────────────────────────────────────────────────────
// ROOT CAUSE GET /? LOOP:
//   Supabase auth-js v2 (flowType: 'implicit' default) setelah signInWithPassword
//   menulis token ke window.location.hash, lalu LANGSUNG menjalankan:
//     window.location.hash = ''   ← ini hard navigation ke /?
//   yang menyebabkan halaman reload, state React hilang, dan loop berlanjut.
//
// FIX:
//   detectSessionInUrl: false  → Supabase tidak scan URL / tidak clear hash
//   flowType: 'pkce'           → password auth tidak pakai hash token sama sekali
// ─────────────────────────────────────────────────────────────────────────────
export const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,   // ← KUNCI: hentikan scan URL & hash clear
        flowType: 'pkce',            // ← PKCE tidak pakai hash, aman untuk password auth
    },
})
