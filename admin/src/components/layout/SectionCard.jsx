export function SectionCard({ children, style = {} }) {
  return (
    <section
      className="panel"
      style={{
        borderRadius: '24px',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </section>
  )
}
