// Generated from the live schema. Do not edit by hand.
//
// Regenerate after any migration:
//   supabase gen types typescript --project-id eqnheftmstapthlblpbx > src/lib/supabase/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      kyc_requests: {
        Row: {
          consent_given: boolean;
          created_at: string;
          date_of_birth: string | null;
          details_hash: string;
          document_expires_on: string | null;
          document_path: string;
          document_type: string;
          email: string;
          full_name: string;
          id: string;
          id_number: string | null;
          rejection_reason: string;
          residential_address: string | null;
          status: string;
          stellar_address: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          consent_given?: boolean;
          created_at?: string;
          date_of_birth?: string | null;
          details_hash: string;
          document_expires_on?: string | null;
          document_path: string;
          document_type: string;
          email: string;
          full_name: string;
          id?: string;
          id_number?: string | null;
          rejection_reason?: string;
          residential_address?: string | null;
          status?: string;
          stellar_address: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          consent_given?: boolean;
          created_at?: string;
          date_of_birth?: string | null;
          details_hash?: string;
          document_expires_on?: string | null;
          document_path?: string;
          document_type?: string;
          email?: string;
          full_name?: string;
          id?: string;
          id_number?: string | null;
          rejection_reason?: string;
          residential_address?: string | null;
          status?: string;
          stellar_address?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kyc_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          last_login_at: string | null;
          legacy_uid: string | null;
          stellar_public_key: string | null;
          updated_at: string;
          wallet_status: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id: string;
          last_login_at?: string | null;
          legacy_uid?: string | null;
          stellar_public_key?: string | null;
          updated_at?: string;
          wallet_status?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          last_login_at?: string | null;
          legacy_uid?: string | null;
          stellar_public_key?: string | null;
          updated_at?: string;
          wallet_status?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_admin: { Args: never; Returns: boolean };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
