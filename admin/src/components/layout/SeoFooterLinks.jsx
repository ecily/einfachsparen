import { seoFooterLinkGroups } from '../../config/seoLandingPages'

export function SeoFooterLinks() {
  return (
    <nav className="seo-footer-links" aria-label="Angebotsseiten">
      <h2>Angebote schneller finden</h2>
      <div className="seo-footer-links__groups">
        {seoFooterLinkGroups.map((group) => (
          <div className="seo-footer-links__group" key={group.title}>
            <h3>{group.title}</h3>
            <ul>
              {group.links.map((link) => (
                <li key={link.path}>
                  <a href={link.path}>{link.label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}
