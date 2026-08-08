interface CategoryChipsProps {
  categories: Array<{ id: string; name: string }>
  activeId?: string
  onSelect: (id?: string) => void
}

export function CategoryChips({ categories, activeId, onSelect }: CategoryChipsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        onClick={() => onSelect(undefined)}
        className={`shrink-0 rounded-full px-4 py-1.5 text-sm ${
          activeId === undefined ? 'bg-brand-600 text-white' : 'bg-white text-gray-600'
        }`}
      >
        全部
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm ${
            activeId === c.id ? 'bg-brand-600 text-white' : 'bg-white text-gray-600'
          }`}
        >
          {c.name}
        </button>
      ))}
    </div>
  )
}
