export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  booking: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          created_at: string
          created_by: string | null
          guest_count: number
          guest_email: string | null
          guest_name: string
          guest_phone: string | null
          id: string
          notes: string | null
          payment_status: Database["booking"]["Enums"]["payment_status"]
          period: unknown
          quoted_total: number
          rate_tier_id: string | null
          reference_code: string
          room_id: string
          room_type_id: string
          source: Database["booking"]["Enums"]["booking_source"]
          status: Database["booking"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          guest_count?: number
          guest_email?: string | null
          guest_name: string
          guest_phone?: string | null
          id?: string
          notes?: string | null
          payment_status?: Database["booking"]["Enums"]["payment_status"]
          period: unknown
          quoted_total: number
          rate_tier_id?: string | null
          reference_code?: string
          room_id: string
          room_type_id: string
          source?: Database["booking"]["Enums"]["booking_source"]
          status?: Database["booking"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          guest_count?: number
          guest_email?: string | null
          guest_name?: string
          guest_phone?: string | null
          id?: string
          notes?: string | null
          payment_status?: Database["booking"]["Enums"]["payment_status"]
          period?: unknown
          quoted_total?: number
          rate_tier_id?: string | null
          reference_code?: string
          room_id?: string
          room_type_id?: string
          source?: Database["booking"]["Enums"]["booking_source"]
          status?: Database["booking"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_rate_tier_id_fkey"
            columns: ["rate_tier_id"]
            isOneToOne: false
            referencedRelation: "rate_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["booking"]["Enums"]["user_role"]
          status: Database["booking"]["Enums"]["invitation_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: Database["booking"]["Enums"]["user_role"]
          status?: Database["booking"]["Enums"]["invitation_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["booking"]["Enums"]["user_role"]
          status?: Database["booking"]["Enums"]["invitation_status"]
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          id: string
          method: Database["booking"]["Enums"]["payment_method"]
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          id?: string
          method?: Database["booking"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          id?: string
          method?: Database["booking"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      rate_tiers: {
        Row: {
          created_at: string
          duration_hours: number | null
          id: string
          is_active: boolean
          kind: Database["booking"]["Enums"]["tier_kind"]
          label: string
          price: number
          room_type_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_hours?: number | null
          id?: string
          is_active?: boolean
          kind: Database["booking"]["Enums"]["tier_kind"]
          label: string
          price: number
          room_type_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_hours?: number | null
          id?: string
          is_active?: boolean
          kind?: Database["booking"]["Enums"]["tier_kind"]
          label?: string
          price?: number
          room_type_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_tiers_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      room_types: {
        Row: {
          base_occupancy: number
          created_at: string
          description: string | null
          excess_person_rate: number
          id: string
          image_url: string | null
          is_active: boolean
          max_occupancy: number
          name: string
          updated_at: string
        }
        Insert: {
          base_occupancy?: number
          created_at?: string
          description?: string | null
          excess_person_rate?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          max_occupancy?: number
          name: string
          updated_at?: string
        }
        Update: {
          base_occupancy?: number
          created_at?: string
          description?: string | null
          excess_person_rate?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          max_occupancy?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          created_at: string
          id: string
          label: string
          notes: string | null
          room_type_id: string
          status: Database["booking"]["Enums"]["room_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          notes?: string | null
          room_type_id: string
          status?: Database["booking"]["Enums"]["room_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          room_type_id?: string
          status?: Database["booking"]["Enums"]["room_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["booking"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["booking"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["booking"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fn_available_rooms: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_exclude_booking?: string
          p_room_type_id: string
        }
        Returns: {
          created_at: string
          id: string
          label: string
          notes: string | null
          room_type_id: string
          status: Database["booking"]["Enums"]["room_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fn_claim_invitation: { Args: never; Returns: boolean }
      fn_count_available: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_room_type_id: string
        }
        Returns: number
      }
      fn_create_booking: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_guest_count: number
          p_guest_email: string
          p_guest_name: string
          p_guest_phone: string
          p_notes?: string
          p_rate_tier_id: string
          p_room_type_id: string
          p_source: Database["booking"]["Enums"]["booking_source"]
        }
        Returns: {
          created_at: string
          created_by: string | null
          guest_count: number
          guest_email: string | null
          guest_name: string
          guest_phone: string | null
          id: string
          notes: string | null
          payment_status: Database["booking"]["Enums"]["payment_status"]
          period: unknown
          quoted_total: number
          rate_tier_id: string | null
          reference_code: string
          room_id: string
          room_type_id: string
          source: Database["booking"]["Enums"]["booking_source"]
          status: Database["booking"]["Enums"]["booking_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_has_role: {
        Args: { p_role: Database["booking"]["Enums"]["user_role"] }
        Returns: boolean
      }
      fn_is_active_user: { Args: never; Returns: boolean }
      fn_is_admin: { Args: never; Returns: boolean }
      gen_reference_code: { Args: never; Returns: string }
    }
    Enums: {
      booking_source: "portal" | "walk_in" | "staff"
      booking_status:
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "cancelled"
        | "no_show"
      invitation_status: "pending" | "accepted" | "revoked" | "expired"
      payment_method: "cash" | "gcash" | "card" | "bank_transfer" | "other"
      payment_status: "unpaid" | "partial" | "paid"
      room_status: "vacant" | "occupied" | "cleaning" | "out_of_service"
      tier_kind: "block" | "overnight"
      user_role: "admin" | "front_desk"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  booking: {
    Enums: {
      booking_source: ["portal", "walk_in", "staff"],
      booking_status: [
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
        "no_show",
      ],
      invitation_status: ["pending", "accepted", "revoked", "expired"],
      payment_method: ["cash", "gcash", "card", "bank_transfer", "other"],
      payment_status: ["unpaid", "partial", "paid"],
      room_status: ["vacant", "occupied", "cleaning", "out_of_service"],
      tier_kind: ["block", "overnight"],
      user_role: ["admin", "front_desk"],
    },
  },
} as const

