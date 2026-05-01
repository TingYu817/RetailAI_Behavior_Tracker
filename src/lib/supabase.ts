import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://sgqynwhduowybxyajusr.supabase.co'
const supabaseKey = 'sb_publishable_w7yZf1Rsn5MqnVQYAssXMA_TDGxm0n0'
export const supabase = createClient(supabaseUrl, supabaseKey)
