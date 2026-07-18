import axios from 'axios';

export const API_BASE = '/api';

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

/** Thin JSON wrapper over axios used by all data-fetching code. */
export async function fetchJson<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const response = await axios.request<T>({
    url: path.startsWith('/') ? path : `${API_BASE}/${path}`,
    method: options.method ?? 'GET',
    data: options.body,
  });
  return response.data;
}
