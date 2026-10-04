import logo from '../../../../build/icon.svg'
import { useApp } from '../store'

export function Welcome(): React.JSX.Element {
  const recent = useApp((s) => s.recent)
  const openVault = useApp((s) => s.openVault)

  return (
    <main className="welcome">
      <img className="welcome-logo" src={logo} alt="" width={56} height={56} />
      <h1>Open a vault</h1>
      <p className="muted">
        A vault is an ordinary folder. Each folder at the top becomes a notebook for one course, and
        folders inside it become sections. Your notes stay plain files you can open anywhere.
      </p>
      <button className="button primary" onClick={() => openVault()}>
        Open folder...
      </button>

      {recent.length > 0 && (
        <section className="recent">
          <h2>Recent</h2>
          <ul>
            {recent.map((root) => (
              <li key={root}>
                <button className="recent-item" onClick={() => openVault(root)}>
                  <span>{root.split(/[\\/]/).pop()}</span>
                  <span className="muted">{root}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
