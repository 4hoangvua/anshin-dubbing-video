import type { ErrorDetail, RFC7807Error } from '../types';

export class ApiError extends Error {
  public code: string;
  public step?: number;
  public details?: Record<string, unknown>;
  public status: number;

  constructor(status: number, errorDetail: ErrorDetail) {
    super(errorDetail.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = errorDetail.code;
    this.step = errorDetail.step;
    this.details = errorDetail.details;
  }
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      ...rest,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });

    clearTimeout(timeoutId);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json') || contentType.includes('application/problem+json');

    if (!response.ok) {
      if (isJson) {
        const errorBody = (await response.json()) as RFC7807Error;
        if (errorBody && errorBody.error) {
          throw new ApiError(response.status, errorBody.error);
        }
      }
      const rawText = await response.text();
      throw new ApiError(response.status, {
        code: `HTTP_${response.status}`,
        message: rawText || response.statusText || 'Yêu cầu tới máy chủ thất bại.',
      });
    }

    if (isJson) {
      return (await response.json()) as T;
    }

    return (await response.text()) as unknown as T;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(408, {
        code: 'REQUEST_TIMEOUT',
        message: 'Yêu cầu máy chủ vượt quá thời gian phản hồi cho phép (Timeout).',
      });
    }

    const message = error instanceof Error ? error.message : 'Lỗi kết nối tới máy chủ AI.';
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message,
    });
  }
}

export const apiClient = {
  get: <T>(url: string, options?: RequestOptions) =>
    request<T>(url, { ...options, method: 'GET' }),

  post: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    request<T>(url, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  put: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    request<T>(url, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(url: string, options?: RequestOptions) =>
    request<T>(url, { ...options, method: 'DELETE' }),
};
