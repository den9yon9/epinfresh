export function Placeholder({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
      {title} — 开发中
    </div>
  )
}
