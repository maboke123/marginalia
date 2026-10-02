import { createContext } from 'react'
import type { AnnotationDoc } from './doc'

/** Null when annotations are off for this PDF (damaged sidecar, or hidden because the PDF changed). */
export const AnnotationContext = createContext<AnnotationDoc | null>(null)
