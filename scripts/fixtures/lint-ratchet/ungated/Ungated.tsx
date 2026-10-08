export function Ungated({ error, value }: { error?: string; value: string }) {
  return (
    <form>
      <p>{error}</p>
      <input type="checkbox" />
      <select value={value} />
    </form>
  )
}
