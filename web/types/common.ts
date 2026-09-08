export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}

export interface ApiErrorShape {
  code?: string;
  message: string;
  details?: unknown;
  field?: string;
  status?: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PaginationMeta;
}
