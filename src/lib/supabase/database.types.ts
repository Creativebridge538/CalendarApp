export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      areas: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "areas_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cast_profile_fields: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cast_profile_fields_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          store_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          store_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          store_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_calculations: {
        Row: {
          base_reward: number
          bonus: number
          calculated_at: string
          calculated_by: string | null
          cast_id: string
          deduction: number
          id: string
          is_finalized: boolean
          period_month: number
          period_year: number
          reward_rate: number
          sales_total: number
          store_id: string
          total_reward: number
        }
        Insert: {
          base_reward?: number
          bonus?: number
          calculated_at?: string
          calculated_by?: string | null
          cast_id: string
          deduction?: number
          id?: string
          is_finalized?: boolean
          period_month: number
          period_year: number
          reward_rate: number
          sales_total?: number
          store_id: string
          total_reward?: number
        }
        Update: {
          base_reward?: number
          bonus?: number
          calculated_at?: string
          calculated_by?: string | null
          cast_id?: string
          deduction?: number
          id?: string
          is_finalized?: boolean
          period_month?: number
          period_year?: number
          reward_rate?: number
          sales_total?: number
          store_id?: string
          total_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "reward_calculations_calculated_by_fkey"
            columns: ["calculated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_calculations_cast_id_fkey"
            columns: ["cast_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_calculations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          area_id: string | null
          capacity: number | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          store_id: string
        }
        Insert: {
          area_id?: string | null
          capacity?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          store_id: string
        }
        Update: {
          area_id?: string | null
          capacity?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount: number
          cast_id: string
          created_at: string
          created_by: string | null
          date: string
          fx_rate_snapshot: number | null
          id: string
          is_daily_payment: boolean
          notes: string | null
          platform: string
          raw_units: number | null
          rate_override: number | null
          reward_rate_override: number | null
          store_id: string
          updated_at: string
          usd_amount: number | null
        }
        Insert: {
          amount?: number
          cast_id: string
          created_at?: string
          created_by?: string | null
          date: string
          fx_rate_snapshot?: number | null
          id?: string
          is_daily_payment?: boolean
          notes?: string | null
          platform?: string
          raw_units?: number | null
          rate_override?: number | null
          reward_rate_override?: number | null
          store_id: string
          updated_at?: string
          usd_amount?: number | null
        }
        Update: {
          amount?: number
          cast_id?: string
          created_at?: string
          created_by?: string | null
          date?: string
          fx_rate_snapshot?: number | null
          id?: string
          is_daily_payment?: boolean
          notes?: string | null
          platform?: string
          raw_units?: number | null
          rate_override?: number | null
          reward_rate_override?: number | null
          store_id?: string
          updated_at?: string
          usd_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_cast_id_fkey"
            columns: ["cast_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_checklist_items: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          item_type: string
          label: string
          options: string[]
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          item_type?: string
          label: string
          options?: string[]
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          item_type?: string
          label?: string
          options?: string[]
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_checklist_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_modification_requests: {
        Row: {
          created_at: string
          id: string
          new_date: string | null
          new_end_time: string | null
          new_room_id: string | null
          new_start_time: string | null
          reason: string
          reject_reason: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          shift_id: string
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          new_date?: string | null
          new_end_time?: string | null
          new_room_id?: string | null
          new_start_time?: string | null
          reason: string
          reject_reason?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          new_date?: string | null
          new_end_time?: string | null
          new_room_id?: string | null
          new_start_time?: string | null
          reason?: string
          reject_reason?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_modification_requests_new_room_id_fkey"
            columns: ["new_room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_modification_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_modification_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_modification_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          admin_note: string | null
          area_id: string | null
          cast_id: string
          checklist_answers: Json
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          date: string
          end_time: string
          id: string
          notes: string | null
          room_id: string | null
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          area_id?: string | null
          cast_id: string
          checklist_answers?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          date: string
          end_time: string
          id?: string
          notes?: string | null
          room_id?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["shift_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          area_id?: string | null
          cast_id?: string
          checklist_answers?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          notes?: string | null
          room_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["shift_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_cast_id_fkey"
            columns: ["cast_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          area_label: string
          created_at: string
          deadline_day: number
          deadline_type: Database["public"]["Enums"]["deadline_type"]
          id: string
          location_mode: string
          logo_url: string | null
          platform_settings: Json
          require_approval_after_deadline: boolean
          room_label: string
          store_id: string
          theme: string
          updated_at: string
          usd_jpy_rate: number | null
        }
        Insert: {
          area_label?: string
          created_at?: string
          deadline_day?: number
          deadline_type?: Database["public"]["Enums"]["deadline_type"]
          id?: string
          location_mode?: string
          logo_url?: string | null
          platform_settings?: Json
          require_approval_after_deadline?: boolean
          room_label?: string
          store_id: string
          theme?: string
          updated_at?: string
          usd_jpy_rate?: number | null
        }
        Update: {
          area_label?: string
          created_at?: string
          deadline_day?: number
          deadline_type?: Database["public"]["Enums"]["deadline_type"]
          id?: string
          location_mode?: string
          logo_url?: string | null
          platform_settings?: Json
          require_approval_after_deadline?: boolean
          room_label?: string
          store_id?: string
          theme?: string
          updated_at?: string
          usd_jpy_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_signup_requests: {
        Row: {
          contact_email: string
          contact_name: string
          created_at: string
          created_store_id: string | null
          id: string
          message: string | null
          phone: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          store_name: string
        }
        Insert: {
          contact_email: string
          contact_name: string
          created_at?: string
          created_store_id?: string | null
          id?: string
          message?: string | null
          phone?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_name: string
        }
        Update: {
          contact_email?: string
          contact_name?: string
          created_at?: string
          created_store_id?: string | null
          id?: string
          message?: string | null
          phone?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_signup_requests_created_store_id_fkey"
            columns: ["created_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_signup_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          calendar_token: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          is_active: boolean
          monthly_goal: number | null
          notes: string | null
          phone: string | null
          photo_url: string | null
          profile_answers: Json
          real_name: string | null
          reward_rate: number
          role: Database["public"]["Enums"]["user_role"]
          store_id: string | null
          updated_at: string
        }
        Insert: {
          calendar_token?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          is_active?: boolean
          monthly_goal?: number | null
          notes?: string | null
          phone?: string | null
          photo_url?: string | null
          profile_answers?: Json
          real_name?: string | null
          reward_rate?: number
          role?: Database["public"]["Enums"]["user_role"]
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          calendar_token?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          is_active?: boolean
          monthly_goal?: number | null
          notes?: string | null
          phone?: string | null
          photo_url?: string | null
          profile_answers?: Json
          real_name?: string | null
          reward_rate?: number
          role?: Database["public"]["Enums"]["user_role"]
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      vacant_slot_applications: {
        Row: {
          cast_id: string
          created_at: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["request_status"]
          vacant_slot_id: string
        }
        Insert: {
          cast_id: string
          created_at?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          vacant_slot_id: string
        }
        Update: {
          cast_id?: string
          created_at?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          vacant_slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacant_slot_applications_cast_id_fkey"
            columns: ["cast_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacant_slot_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacant_slot_applications_vacant_slot_id_fkey"
            columns: ["vacant_slot_id"]
            isOneToOne: false
            referencedRelation: "vacant_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      vacant_slots: {
        Row: {
          created_at: string
          created_by: string
          date: string
          end_time: string
          id: string
          is_published: boolean
          notes: string | null
          room_id: string | null
          start_time: string
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          date: string
          end_time: string
          id?: string
          is_published?: boolean
          notes?: string | null
          room_id?: string | null
          start_time: string
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          date?: string
          end_time?: string
          id?: string
          is_published?: boolean
          notes?: string | null
          room_id?: string | null
          start_time?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacant_slots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacant_slots_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacant_slots_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      my_store_id: { Args: never; Returns: string }
    }
    Enums: {
      deadline_type: "monthly" | "weekly" | "none"
      request_status: "pending" | "approved" | "rejected"
      shift_status: "draft" | "submitted" | "confirmed" | "rejected"
      user_role: "admin" | "cast"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      deadline_type: ["monthly", "weekly", "none"],
      request_status: ["pending", "approved", "rejected"],
      shift_status: ["draft", "submitted", "confirmed", "rejected"],
      user_role: ["admin", "cast"],
    },
  },
} as const

