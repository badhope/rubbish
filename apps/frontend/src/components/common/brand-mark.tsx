/**
 * Rubbish 标志 —— 唯一在用的“纸折 R”。
 *
 * 一条实心 R 骨架，右上角回收箭头；没有纸页层、没有底线。
 * 小尺寸（导航 20–28px）与 favicon 共用同一几何，放大后仍是干净边缘。
 * 图形与 public/favicon.svg、public/brand/rubbish-r.svg 同源。
 */
export function BrandMark({
  className,
  decorative = false,
}: {
  className?: string
  /** 与文字字标并排时置为装饰图，避免读屏把品牌名读两遍 */
  decorative?: boolean
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : 'Rubbish'}
      aria-hidden={decorative || undefined}
      className={`inline-block shrink-0 ${className ?? ''}`}
    >
      <rect x="1" y="1" width="62" height="62" rx="10" fill="#F4EFE4" />
      <path
        d="M17 13h18.5c8.8 0 14.3 4.6 14.3 12 0 5.6-3.2 9.6-8.6 11l11.4 15H40.4L30.5 37.2h-4.2v13.8H17V13Zm9.3 7.7v9.1h8.5c4 0 6.4-1.7 6.4-4.6 0-2.8-2.4-4.5-6.4-4.5h-8.5Z"
        fill="#2F5D46"
      />
      <path
        d="M45.5 8.5c4.2 1.4 7.2 4.6 8.4 8.6"
        fill="none"
        stroke="#1F7A4D"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M54.5 17.8 55 24l-6.2-1.2"
        fill="none"
        stroke="#1F7A4D"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
