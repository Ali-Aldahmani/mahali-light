export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body?: string;
  action_url?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface ReportDefinition {
  category: string;
  type: string;
  label: string;
}
