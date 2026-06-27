import { ref } from 'vue'

export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface ModalAnchorStyle {
  position: 'fixed'
  top?: string
  left?: string
  right?: string
  bottom?: string
  width: string
  maxWidth: string
  maxHeight: string
}

export function useModalAnchor() {
  const anchorRect = ref<AnchorRect | null>(null)

  function setAnchorFromEvent(event: MouseEvent | TouchEvent) {
    const target = event.currentTarget as HTMLElement | null
    if (target) {
      anchorRect.value = target.getBoundingClientRect() as AnchorRect
    }
  }

  function setAnchorFromElement(el: HTMLElement | null) {
    if (el) {
      anchorRect.value = el.getBoundingClientRect() as AnchorRect
    }
  }

  function clearAnchor() {
    anchorRect.value = null
  }

  function computePosition(
    preferredWidth = 384,
    minHeight = 180,
    gap = 8,
  ): ModalAnchorStyle | null {
    const rect = anchorRect.value
    if (!rect)
      return null

    const vw = window.innerWidth
    const vh = window.innerHeight

    const width = Math.min(preferredWidth, vw - gap * 2)
    let left = rect.left
    if (left + width > vw - gap) {
      left = Math.max(gap, vw - width - gap)
    }

    const spaceBelow = vh - rect.bottom - gap
    const spaceAbove = rect.top - gap

    let position: 'below' | 'above' = 'below'
    let maxHeight: number

    if (spaceBelow >= minHeight) {
      position = 'below'
      maxHeight = spaceBelow
    }
    else if (spaceAbove >= minHeight) {
      position = 'above'
      maxHeight = spaceAbove
    }
    else {
      if (spaceBelow >= spaceAbove) {
        position = 'below'
        maxHeight = spaceBelow
      }
      else {
        position = 'above'
        maxHeight = spaceAbove
      }
    }

    maxHeight = Math.max(minHeight, Math.min(maxHeight, Math.min(600, vh - gap * 2)))

    return {
      position: 'fixed',
      left: `${left}px`,
      top: position === 'below' ? `${rect.bottom + gap}px` : undefined,
      bottom: position === 'above' ? `${vh - rect.top + gap}px` : undefined,
      width: `${width}px`,
      maxWidth: `${width}px`,
      maxHeight: `${maxHeight}px`,
    }
  }

  return {
    anchorRect,
    setAnchorFromEvent,
    setAnchorFromElement,
    clearAnchor,
    computePosition,
  }
}
