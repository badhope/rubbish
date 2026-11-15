import type { ReactNode, ElementType, CSSProperties } from 'react'
import { motion } from 'motion/react'
import { useInViewReveal } from '@/hooks/use-in-view-reveal'

/**
 * Scroll-reveal wrapper that replaces motion's `whileInView`.
 *
 * motion 14.5.0's `whileInView` never advances in this app (verified in the
 * production build too), leaving sections stuck at their initial 0.3 opacity.
 * This wrapper drives the same transition from a native IntersectionObserver
 * while keeping motion's tween/easing.
 */
export function RevealSection({
  as = 'section',
  className,
  children,
  y = 14,
  duration = 0.45,
  delay = 0,
  rootMargin = '0px 0px 200px 0px',
  style,
  id,
}: {
  as?: ElementType
  className?: string
  children?: ReactNode
  y?: number
  duration?: number
  delay?: number
  rootMargin?: string
  style?: CSSProperties
  id?: string
}) {
  const [setRef, revealed] = useInViewReveal({ rootMargin })
  const Comp = motion[as as keyof typeof motion] as typeof motion.section

  return (
    <Comp
      ref={setRef}
      id={id}
      className={className}
      style={style}
      initial={{ opacity: 0.3, y }}
      animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0.3, y }}
      transition={{ duration, delay, ease: 'easeOut' }}
    >
      {children}
    </Comp>
  )
}
