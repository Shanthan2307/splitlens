export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"];
          actor_id: string | null;
          comment_id: string | null;
          created_at: string;
          expense_id: string | null;
          group_id: string | null;
          id: number;
          involved_user_ids: string[];
          payload: NonNullable<Json>;
          settlement_id: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["activity_action"];
          actor_id?: string | null;
          comment_id?: string | null;
          created_at?: string;
          expense_id?: string | null;
          group_id?: string | null;
          id?: never;
          involved_user_ids?: string[];
          payload?: NonNullable<Json>;
          settlement_id?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["activity_action"];
          actor_id?: string | null;
          comment_id?: string | null;
          created_at?: string;
          expense_id?: string | null;
          group_id?: string | null;
          id?: never;
          involved_user_ids?: string[];
          payload?: NonNullable<Json>;
          settlement_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_settlement_id_fkey";
            columns: ["settlement_id"];
            isOneToOne: false;
            referencedRelation: "settlements";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          created_at: string;
          expense_id: string;
          file_name: string;
          id: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          uploaded_by: string | null;
        };
        Insert: {
          created_at?: string;
          expense_id: string;
          file_name: string;
          id?: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          uploaded_by?: string | null;
        };
        Update: {
          created_at?: string;
          expense_id?: string;
          file_name?: string;
          id?: string;
          mime_type?: string;
          size_bytes?: number;
          storage_path?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          author_id: string | null;
          body: string;
          created_at: string;
          expense_id: string | null;
          id: string;
          is_deleted: boolean;
          settlement_id: string | null;
          splitwise_comment_id: number | null;
          updated_at: string;
        };
        Insert: {
          author_id?: string | null;
          body: string;
          created_at?: string;
          expense_id?: string | null;
          id?: string;
          is_deleted?: boolean;
          settlement_id?: string | null;
          splitwise_comment_id?: number | null;
          updated_at?: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          created_at?: string;
          expense_id?: string | null;
          id?: string;
          is_deleted?: boolean;
          settlement_id?: string | null;
          splitwise_comment_id?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_settlement_id_fkey";
            columns: ["settlement_id"];
            isOneToOne: false;
            referencedRelation: "settlements";
            referencedColumns: ["id"];
          },
        ];
      };
      exchange_rates: {
        Row: {
          base_currency: string;
          fetched_at: string;
          quote_currency: string;
          rate: number;
          rate_date: string;
          source: string;
        };
        Insert: {
          base_currency: string;
          fetched_at?: string;
          quote_currency: string;
          rate: number;
          rate_date: string;
          source: string;
        };
        Update: {
          base_currency?: string;
          fetched_at?: string;
          quote_currency?: string;
          rate?: number;
          rate_date?: string;
          source?: string;
        };
        Relationships: [];
      };
      expense_items: {
        Row: {
          created_at: string;
          expense_id: string;
          id: string;
          kind: Database["public"]["Enums"]["expense_item_kind"];
          name: string;
          original_name: string | null;
          position: number;
          quantity: number;
          total_minor: number;
          unit_price_minor: number | null;
        };
        Insert: {
          created_at?: string;
          expense_id: string;
          id?: string;
          kind?: Database["public"]["Enums"]["expense_item_kind"];
          name: string;
          original_name?: string | null;
          position?: number;
          quantity?: number;
          total_minor: number;
          unit_price_minor?: number | null;
        };
        Update: {
          created_at?: string;
          expense_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["expense_item_kind"];
          name?: string;
          original_name?: string | null;
          position?: number;
          quantity?: number;
          total_minor?: number;
          unit_price_minor?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_items_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_payers: {
        Row: {
          expense_id: string;
          id: string;
          member_id: string | null;
          paid_minor: number;
          user_id: string | null;
        };
        Insert: {
          expense_id: string;
          id?: string;
          member_id?: string | null;
          paid_minor: number;
          user_id?: string | null;
        };
        Update: {
          expense_id?: string;
          id?: string;
          member_id?: string | null;
          paid_minor?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_payers_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_payers_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "group_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_payers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_shares: {
        Row: {
          expense_id: string;
          id: string;
          member_id: string | null;
          owed_minor: number;
          split_input: number | null;
          user_id: string | null;
        };
        Insert: {
          expense_id: string;
          id?: string;
          member_id?: string | null;
          owed_minor: number;
          split_input?: number | null;
          user_id?: string | null;
        };
        Update: {
          expense_id?: string;
          id?: string;
          member_id?: string | null;
          owed_minor?: number;
          split_input?: number | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_shares_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_shares_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "group_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_shares_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          category: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          deleted_at: string | null;
          deleted_by: string | null;
          description: string;
          expense_date: string;
          group_id: string | null;
          id: string;
          is_deleted: boolean;
          notes: string | null;
          receipt_id: string | null;
          recurring_rule_id: string | null;
          split_type: Database["public"]["Enums"]["split_type"];
          splitwise_expense_id: number | null;
          total_minor: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          category?: string;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description: string;
          expense_date?: string;
          group_id?: string | null;
          id?: string;
          is_deleted?: boolean;
          notes?: string | null;
          receipt_id?: string | null;
          recurring_rule_id?: string | null;
          split_type?: Database["public"]["Enums"]["split_type"];
          splitwise_expense_id?: number | null;
          total_minor: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          category?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string;
          expense_date?: string;
          group_id?: string | null;
          id?: string;
          is_deleted?: boolean;
          notes?: string | null;
          receipt_id?: string | null;
          recurring_rule_id?: string | null;
          split_type?: Database["public"]["Enums"]["split_type"];
          splitwise_expense_id?: number | null;
          total_minor?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_receipt_id_fkey";
            columns: ["receipt_id"];
            isOneToOne: false;
            referencedRelation: "receipts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_recurring_rule_id_fkey";
            columns: ["recurring_rule_id"];
            isOneToOne: false;
            referencedRelation: "recurring_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      friendships: {
        Row: {
          accepted_at: string | null;
          addressee_id: string;
          created_at: string;
          id: string;
          requester_id: string;
          status: Database["public"]["Enums"]["friendship_status"];
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          addressee_id: string;
          created_at?: string;
          id?: string;
          requester_id: string;
          status?: Database["public"]["Enums"]["friendship_status"];
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          addressee_id?: string;
          created_at?: string;
          id?: string;
          requester_id?: string;
          status?: Database["public"]["Enums"]["friendship_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey";
            columns: ["addressee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friendships_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_members: {
        Row: {
          created_at: string;
          default_split_weight: number | null;
          group_id: string;
          id: string;
          joined_at: string;
          left_at: string | null;
          placeholder_email: string | null;
          placeholder_name: string | null;
          role: Database["public"]["Enums"]["group_role"];
          splitwise_user_id: number | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          default_split_weight?: number | null;
          group_id: string;
          id?: string;
          joined_at?: string;
          left_at?: string | null;
          placeholder_email?: string | null;
          placeholder_name?: string | null;
          role?: Database["public"]["Enums"]["group_role"];
          splitwise_user_id?: number | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          default_split_weight?: number | null;
          group_id?: string;
          id?: string;
          joined_at?: string;
          left_at?: string | null;
          placeholder_email?: string | null;
          placeholder_name?: string | null;
          role?: Database["public"]["Enums"]["group_role"];
          splitwise_user_id?: number | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      groups: {
        Row: {
          cover_image_path: string | null;
          created_at: string;
          created_by: string | null;
          default_currency: string;
          default_split_type: Database["public"]["Enums"]["split_type"];
          deleted_at: string | null;
          id: string;
          name: string;
          simplify_debts: boolean;
          splitwise_group_id: number | null;
          type: Database["public"]["Enums"]["group_type"];
          updated_at: string;
        };
        Insert: {
          cover_image_path?: string | null;
          created_at?: string;
          created_by?: string | null;
          default_currency?: string;
          default_split_type?: Database["public"]["Enums"]["split_type"];
          deleted_at?: string | null;
          id?: string;
          name: string;
          simplify_debts?: boolean;
          splitwise_group_id?: number | null;
          type?: Database["public"]["Enums"]["group_type"];
          updated_at?: string;
        };
        Update: {
          cover_image_path?: string | null;
          created_at?: string;
          created_by?: string | null;
          default_currency?: string;
          default_split_type?: Database["public"]["Enums"]["split_type"];
          deleted_at?: string | null;
          id?: string;
          name?: string;
          simplify_debts?: boolean;
          splitwise_group_id?: number | null;
          type?: Database["public"]["Enums"]["group_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      invite_links: {
        Row: {
          created_at: string;
          created_by: string;
          email: string | null;
          expires_at: string | null;
          group_id: string | null;
          id: string;
          max_uses: number | null;
          member_id: string | null;
          revoked_at: string | null;
          token: string;
          use_count: number;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          email?: string | null;
          expires_at?: string | null;
          group_id?: string | null;
          id?: string;
          max_uses?: number | null;
          member_id?: string | null;
          revoked_at?: string | null;
          token?: string;
          use_count?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          email?: string | null;
          expires_at?: string | null;
          group_id?: string | null;
          id?: string;
          max_uses?: number | null;
          member_id?: string | null;
          revoked_at?: string | null;
          token?: string;
          use_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invite_links_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invite_links_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invite_links_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "group_members";
            referencedColumns: ["id"];
          },
        ];
      };
      item_assignments: {
        Row: {
          id: string;
          item_id: string;
          member_id: string | null;
          share_weight: number;
          user_id: string | null;
        };
        Insert: {
          id?: string;
          item_id: string;
          member_id?: string | null;
          share_weight?: number;
          user_id?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string;
          member_id?: string | null;
          share_weight?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "item_assignments_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "expense_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_assignments_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "group_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_assignments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_settings: {
        Row: {
          email_comment_added: boolean;
          email_expense_added: boolean;
          email_expense_updated: boolean;
          email_friend_added: boolean;
          email_group_added: boolean;
          email_monthly_summary: boolean;
          email_settlement: boolean;
          push_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          email_comment_added?: boolean;
          email_expense_added?: boolean;
          email_expense_updated?: boolean;
          email_friend_added?: boolean;
          email_group_added?: boolean;
          email_monthly_summary?: boolean;
          email_settlement?: boolean;
          push_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          email_comment_added?: boolean;
          email_expense_added?: boolean;
          email_expense_updated?: boolean;
          email_friend_added?: boolean;
          email_group_added?: boolean;
          email_monthly_summary?: boolean;
          email_settlement?: boolean;
          push_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_settings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          activity_id: number | null;
          created_at: string;
          emailed_at: string | null;
          id: number;
          kind: string;
          payload: NonNullable<Json>;
          read_at: string | null;
          user_id: string;
        };
        Insert: {
          activity_id?: number | null;
          created_at?: string;
          emailed_at?: string | null;
          id?: never;
          kind: string;
          payload?: NonNullable<Json>;
          read_at?: string | null;
          user_id: string;
        };
        Update: {
          activity_id?: number | null;
          created_at?: string;
          emailed_at?: string | null;
          id?: never;
          kind?: string;
          payload?: NonNullable<Json>;
          read_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_activity_id_fkey";
            columns: ["activity_id"];
            isOneToOne: false;
            referencedRelation: "activity_log";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
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
          default_currency: string;
          display_name: string;
          email: string | null;
          id: string;
          paypal_username: string | null;
          preferred_language: string;
          splitwise_user_id: number | null;
          updated_at: string;
          venmo_username: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          default_currency?: string;
          display_name?: string;
          email?: string | null;
          id: string;
          paypal_username?: string | null;
          preferred_language?: string;
          splitwise_user_id?: number | null;
          updated_at?: string;
          venmo_username?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          default_currency?: string;
          display_name?: string;
          email?: string | null;
          id?: string;
          paypal_username?: string | null;
          preferred_language?: string;
          splitwise_user_id?: number | null;
          updated_at?: string;
          venmo_username?: string | null;
        };
        Relationships: [];
      };
      receipts: {
        Row: {
          created_at: string;
          currency: string | null;
          error_message: string | null;
          group_id: string | null;
          id: string;
          merchant_name: string | null;
          mime_type: string;
          model: string | null;
          parsed: Json | null;
          raw_model_json: Json | null;
          receipt_date: string | null;
          source_language: string | null;
          status: Database["public"]["Enums"]["receipt_status"];
          storage_path: string;
          target_language: string | null;
          total_minor: number | null;
          updated_at: string;
          uploaded_by: string;
        };
        Insert: {
          created_at?: string;
          currency?: string | null;
          error_message?: string | null;
          group_id?: string | null;
          id?: string;
          merchant_name?: string | null;
          mime_type: string;
          model?: string | null;
          parsed?: Json | null;
          raw_model_json?: Json | null;
          receipt_date?: string | null;
          source_language?: string | null;
          status?: Database["public"]["Enums"]["receipt_status"];
          storage_path: string;
          target_language?: string | null;
          total_minor?: number | null;
          updated_at?: string;
          uploaded_by: string;
        };
        Update: {
          created_at?: string;
          currency?: string | null;
          error_message?: string | null;
          group_id?: string | null;
          id?: string;
          merchant_name?: string | null;
          mime_type?: string;
          model?: string | null;
          parsed?: Json | null;
          raw_model_json?: Json | null;
          receipt_date?: string | null;
          source_language?: string | null;
          status?: Database["public"]["Enums"]["receipt_status"];
          storage_path?: string;
          target_language?: string | null;
          total_minor?: number | null;
          updated_at?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receipts_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "receipts_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_rules: {
        Row: {
          created_at: string;
          created_by: string;
          end_date: string | null;
          frequency: Database["public"]["Enums"]["recurrence_frequency"];
          group_id: string | null;
          id: string;
          interval_count: number;
          is_active: boolean;
          last_run_at: string | null;
          next_run_on: string;
          start_date: string;
          template: NonNullable<Json>;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          end_date?: string | null;
          frequency: Database["public"]["Enums"]["recurrence_frequency"];
          group_id?: string | null;
          id?: string;
          interval_count?: number;
          is_active?: boolean;
          last_run_at?: string | null;
          next_run_on: string;
          start_date: string;
          template: NonNullable<Json>;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          end_date?: string | null;
          frequency?: Database["public"]["Enums"]["recurrence_frequency"];
          group_id?: string | null;
          id?: string;
          interval_count?: number;
          is_active?: boolean;
          last_run_at?: string | null;
          next_run_on?: string;
          start_date?: string;
          template?: NonNullable<Json>;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_rules_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_rules_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      settlements: {
        Row: {
          amount_minor: number;
          created_at: string;
          created_by: string | null;
          currency: string;
          deleted_at: string | null;
          deleted_by: string | null;
          external_provider: string | null;
          from_member_id: string | null;
          from_user_id: string | null;
          group_id: string | null;
          id: string;
          is_deleted: boolean;
          method: Database["public"]["Enums"]["settlement_method"];
          notes: string | null;
          settled_on: string;
          splitwise_expense_id: number | null;
          to_member_id: string | null;
          to_user_id: string | null;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          external_provider?: string | null;
          from_member_id?: string | null;
          from_user_id?: string | null;
          group_id?: string | null;
          id?: string;
          is_deleted?: boolean;
          method?: Database["public"]["Enums"]["settlement_method"];
          notes?: string | null;
          settled_on?: string;
          splitwise_expense_id?: number | null;
          to_member_id?: string | null;
          to_user_id?: string | null;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          external_provider?: string | null;
          from_member_id?: string | null;
          from_user_id?: string | null;
          group_id?: string | null;
          id?: string;
          is_deleted?: boolean;
          method?: Database["public"]["Enums"]["settlement_method"];
          notes?: string | null;
          settled_on?: string;
          splitwise_expense_id?: number | null;
          to_member_id?: string | null;
          to_user_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settlements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_from_member_id_fkey";
            columns: ["from_member_id"];
            isOneToOne: false;
            referencedRelation: "group_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_from_user_id_fkey";
            columns: ["from_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_to_member_id_fkey";
            columns: ["to_member_id"];
            isOneToOne: false;
            referencedRelation: "group_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_to_user_id_fkey";
            columns: ["to_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      splitwise_connections: {
        Row: {
          access_token_encrypted: string;
          created_at: string;
          last_synced_at: string | null;
          refresh_token_encrypted: string | null;
          scope: string | null;
          splitwise_user_id: number;
          sync_error: string | null;
          sync_status: Database["public"]["Enums"]["sync_status"];
          token_expires_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token_encrypted: string;
          created_at?: string;
          last_synced_at?: string | null;
          refresh_token_encrypted?: string | null;
          scope?: string | null;
          splitwise_user_id: number;
          sync_error?: string | null;
          sync_status?: Database["public"]["Enums"]["sync_status"];
          token_expires_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token_encrypted?: string;
          created_at?: string;
          last_synced_at?: string | null;
          refresh_token_encrypted?: string | null;
          scope?: string | null;
          splitwise_user_id?: number;
          sync_error?: string | null;
          sync_status?: Database["public"]["Enums"]["sync_status"];
          token_expires_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "splitwise_connections_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_comment: {
        Args: { p_body: string; p_expense_id: string; p_settlement_id: string };
        Returns: string;
      };
      add_group_member: {
        Args: { p_email: string; p_group_id: string; p_name: string };
        Returns: Json;
      };
      create_group: {
        Args: {
          p_default_currency: string;
          p_name: string;
          p_simplify_debts: boolean;
          p_type: Database["public"]["Enums"]["group_type"];
        };
        Returns: string;
      };
      delete_comment: { Args: { p_comment_id: string }; Returns: undefined };
      delete_group: { Args: { p_group_id: string }; Returns: undefined };
      get_invite: { Args: { p_token: string }; Returns: Json };
      redeem_friend_invite: { Args: { p_token: string }; Returns: string };
      redeem_invite: { Args: { p_claim_member_id?: string; p_token: string }; Returns: string };
      remove_group_member: { Args: { p_member_id: string }; Returns: undefined };
      respond_friend_request: {
        Args: { p_accept: boolean; p_friendship_id: string };
        Returns: undefined;
      };
      save_expense: { Args: { p_expense: Json }; Returns: string };
      save_settlement: { Args: { p_settlement: Json }; Returns: string };
      send_friend_request: { Args: { p_email: string }; Returns: string };
      set_expense_deleted: {
        Args: { p_deleted: boolean; p_expense_id: string };
        Returns: undefined;
      };
      set_settlement_deleted: {
        Args: { p_deleted: boolean; p_settlement_id: string };
        Returns: undefined;
      };
      splitwise_import_expenses: {
        Args: { p_expenses: Json; p_group_id: string; p_people: Json; p_user: string };
        Returns: Json;
      };
      splitwise_import_group: { Args: { p_group: Json; p_user: string }; Returns: Json };
      splitwise_link_account: {
        Args: { p_splitwise_user_id: number; p_user: string };
        Returns: number;
      };
      splitwise_log_import: {
        Args: { p_group_id: string; p_summary: Json; p_user: string };
        Returns: undefined;
      };
      splitwise_unlink_account: { Args: { p_user: string }; Returns: undefined };
      update_group: { Args: { p_group_id: string; p_patch: Json }; Returns: undefined };
    };
    Enums: {
      activity_action:
        | "expense_created"
        | "expense_updated"
        | "expense_deleted"
        | "expense_restored"
        | "settlement_created"
        | "settlement_updated"
        | "settlement_deleted"
        | "settlement_restored"
        | "comment_added"
        | "comment_deleted"
        | "group_created"
        | "group_updated"
        | "group_deleted"
        | "member_added"
        | "member_removed"
        | "member_left"
        | "placeholder_claimed"
        | "friend_requested"
        | "friend_accepted"
        | "friend_removed"
        | "receipt_parsed"
        | "recurring_expense_created"
        | "splitwise_import_completed";
      expense_item_kind: "item" | "tax" | "tip" | "service" | "discount" | "fee";
      friendship_status: "pending" | "accepted";
      group_role: "owner" | "member";
      group_type: "home" | "trip" | "couple" | "other";
      receipt_status: "uploaded" | "processing" | "parsed" | "failed";
      recurrence_frequency: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
      settlement_method: "cash" | "bank_transfer" | "external_app" | "other";
      split_type: "equal" | "exact" | "percentage" | "shares" | "adjustment" | "itemized";
      sync_status: "idle" | "running" | "succeeded" | "failed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      activity_action: [
        "expense_created",
        "expense_updated",
        "expense_deleted",
        "expense_restored",
        "settlement_created",
        "settlement_updated",
        "settlement_deleted",
        "settlement_restored",
        "comment_added",
        "comment_deleted",
        "group_created",
        "group_updated",
        "group_deleted",
        "member_added",
        "member_removed",
        "member_left",
        "placeholder_claimed",
        "friend_requested",
        "friend_accepted",
        "friend_removed",
        "receipt_parsed",
        "recurring_expense_created",
        "splitwise_import_completed",
      ],
      expense_item_kind: ["item", "tax", "tip", "service", "discount", "fee"],
      friendship_status: ["pending", "accepted"],
      group_role: ["owner", "member"],
      group_type: ["home", "trip", "couple", "other"],
      receipt_status: ["uploaded", "processing", "parsed", "failed"],
      recurrence_frequency: ["daily", "weekly", "biweekly", "monthly", "yearly"],
      settlement_method: ["cash", "bank_transfer", "external_app", "other"],
      split_type: ["equal", "exact", "percentage", "shares", "adjustment", "itemized"],
      sync_status: ["idle", "running", "succeeded", "failed"],
    },
  },
} as const;
