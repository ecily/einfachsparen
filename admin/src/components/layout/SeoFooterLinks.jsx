import { filterIndexableSeoLinks } from '../../utils/seoBuildPolicy.js'
import { seoFooterLinkGroups } from '../../config/seoLandingPages'

export function SeoFooterLinks() {
  const groups = seoFooterLinkGroups.map((group) => ({ ...group, links: filterIndexableSeoLinks(group.links) })).filter((group) => group.links.length)
  return (
    <nav className="seo-footer-links" aria-label="Angebotsseiten">
      <h2>Direkt zu beliebten Angeboten</h2>
      <div className="seo-footer-links__groups">
        {groups.map((group) => (
          <div className="seo-footer-links__group" key={group.title}>
            <h3>{group.title}</h3>
            <ul>
              {group.links.map((link) => (
                <li key={`${link.key}:${link.label}`}>
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
