import React, { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileText } from 'lucide-react'

export interface VirtualCueTableProps<T> {
  items: T[]
  renderRow: (item: T, index: number) => React.ReactNode
  estimateSize?: number | ((index: number) => number)
  overscan?: number
  header?: React.ReactNode
  emptyMessage?: string
  className?: string
}

export function VirtualCueTable<T>({
  items,
  renderRow,
  estimateSize = 74,
  overscan = 5,
  header,
  emptyMessage = 'Chưa có dữ liệu câu thoại.',
  className = ''
}: VirtualCueTableProps<T>) {
  const parentRef = useRef<HTMLDivElement | null>(null)

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: typeof estimateSize === 'function' ? estimateSize : () => estimateSize,
    overscan,
  })

  return (
    <div className={`flex flex-col h-full bg-slate-950 overflow-hidden ${className}`}>
      {/* Sticky Table Header */}
      {header && (
        <div className="shrink-0 bg-slate-900 border-b border-slate-800 text-xs font-semibold text-slate-400 select-none z-10">
          {header}
        </div>
      )}

      {/* Virtual Scroll Viewport */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center">
            <FileText className="w-10 h-10 mb-2 opacity-30 text-indigo-400" />
            <p className="text-sm">{emptyMessage}</p>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative'
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  {renderRow(item, virtualRow.index)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
