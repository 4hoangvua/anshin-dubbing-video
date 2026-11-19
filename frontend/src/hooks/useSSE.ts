import { useState, useRef, useCallback } from 'react'
import type { SSEProgressEvent } from '../types'

export interface UseSSEReturn {
  isRunning: boolean
  percent: number
  stage: string
  message: string
  lastEvent: SSEProgressEvent | null
  error: string | null
  startStream: (
    url: string,
    body?: Record<string, unknown>,
    callbacks?: {
      onProgress?: (event: SSEProgressEvent) => void
      onComplete?: (event: SSEProgressEvent) => void
      onError?: (err: Error) => void
    }
  ) => Promise<void>
  stopStream: () => void
  reset: () => void
}

export function useSSE(): UseSSEReturn {
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [percent, setPercent] = useState<number>(0)
  const [stage, setStage] = useState<string>('')
  const [message, setMessage] = useState<string>('')
  const [lastEvent, setLastEvent] = useState<SSEProgressEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsRunning(false)
  }, [])

  const reset = useCallback(() => {
    stopStream()
    setPercent(0)
    setStage('')
    setMessage('')
    setLastEvent(null)
    setError(null)
  }, [stopStream])

  const startStream = useCallback(
    async (
      url: string,
      body?: Record<string, unknown>,
      callbacks?: {
        onProgress?: (event: SSEProgressEvent) => void
        onComplete?: (event: SSEProgressEvent) => void
        onError?: (err: Error) => void
      }
    ) => {
      // Abort any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      const controller = new AbortController()
      abortControllerRef.current = controller

      setIsRunning(true)
      setPercent(0)
      setStage('Đang khởi tạo...')
      setMessage('')
      setError(null)

      try {
        const response = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream'
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        })

        if (!response.ok) {
          let errDetail = `Lỗi máy chủ (${response.status})`
          try {
            const errJson = await response.json()
            if (errJson.error?.message) {
              errDetail = errJson.error.message
            } else if (errJson.detail) {
              errDetail = errJson.detail
            }
          } catch {
            // response was not JSON
          }
          throw new Error(errDetail)
        }

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('Trình duyệt không hỗ trợ đọc ReadableStream.')
        }

        const decoder = new TextDecoder('utf-8')
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          // The last element is either empty or incomplete chunk
          buffer = blocks.pop() || ''

          for (const block of blocks) {
            if (!block.trim()) continue

            const lines = block.split('\n')
            let eventType = 'message'
            let rawData = ''

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventType = line.replace('event:', '').trim()
              } else if (line.startsWith('data:')) {
                rawData = line.replace('data:', '').trim()
              }
            }

            if (!rawData) continue

            try {
              const parsed: SSEProgressEvent = JSON.parse(rawData)
              setLastEvent(parsed)

              if (parsed.percent !== undefined) {
                setPercent(parsed.percent)
              }
              if (parsed.stage) {
                setStage(parsed.stage)
              }
              if (parsed.message) {
                setMessage(parsed.message)
              }

              if (eventType === 'progress') {
                callbacks?.onProgress?.(parsed)
              } else if (eventType === 'complete') {
                setPercent(100)
                setStage('Hoàn tất')
                callbacks?.onComplete?.(parsed)
              } else if (eventType === 'error') {
                const rawObj = parsed as Record<string, any>
                const errMsg = rawObj.data?.message || rawObj.error?.message || rawObj.message || 'Lỗi xử lý tác vụ'
                setError(errMsg)
                callbacks?.onError?.(new Error(errMsg))
                return
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
                console.warn('Lỗi phân tích cú pháp sự kiện SSE:', parseErr)
              }
            }
          }
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          console.log('SSE Stream cancelled by user.')
          return
        }
        const msg = err instanceof Error ? err.message : 'Lỗi kết nối máy chủ'
        setError(msg)
        callbacks?.onError?.(err instanceof Error ? err : new Error(msg))
      } finally {
        setIsRunning(false)
        abortControllerRef.current = null
      }
    },
    []
  )

  return {
    isRunning,
    percent,
    stage,
    message,
    lastEvent,
    error,
    startStream,
    stopStream,
    reset
  }
}
