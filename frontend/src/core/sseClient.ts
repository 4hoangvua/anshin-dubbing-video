import type { SSEProgressEvent } from '../types';

export interface SSEStreamOptions {
  onProgress?: (event: SSEProgressEvent) => void;
  onComplete?: (event: SSEProgressEvent) => void;
  onError?: (error: Error) => void;
}

/**
 * Đọc luồng Server-Sent Events (SSE) phát ra từ HTTP POST/GET request
 * bằng Fetch API + ReadableStream, hỗ trợ truyền body JSON đầy đủ.
 */
export async function streamSSE(
  url: string,
  body?: unknown,
  options: SSEStreamOptions = {},
  signal?: AbortSignal
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!response.ok) {
      let errMsg = `Lỗi máy chủ (${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson.error?.message) {
          errMsg = errJson.error.message;
        } else if (errJson.detail) {
          errMsg = errJson.detail;
        }
      } catch {
        // Not JSON
      }
      throw new Error(errMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Trình duyệt không hỗ trợ đọc luồng dữ liệu (ReadableStream).');
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        if (!block.trim()) continue;

        const lines = block.split('\n');
        let eventType = 'message';
        let rawData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.replace('event:', '').trim();
          } else if (line.startsWith('data:')) {
            rawData = line.replace('data:', '').trim();
          }
        }

        if (!rawData) continue;

        try {
          const parsed: SSEProgressEvent = JSON.parse(rawData);

          if (eventType === 'complete' || parsed.percent >= 100 || parsed.stage === 'completed') {
            options.onComplete?.(parsed);
          } else if (eventType === 'error' || parsed.error) {
            const errDetail = parsed.error?.message || (parsed as any).message || 'Lỗi trong quá trình xử lý';
            options.onError?.(new Error(errDetail));
            return;
          } else {
            options.onProgress?.(parsed);
          }
        } catch {
          // Ignore parse errors on partial chunks
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) {
      console.log('SSE Stream cancelled by user.');
      return;
    }
    const error = err instanceof Error ? err : new Error('Mất kết nối với máy chủ');
    options.onError?.(error);
  }
}
